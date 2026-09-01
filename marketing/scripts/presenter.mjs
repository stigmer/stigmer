#!/usr/bin/env node
/**
 * Generate HeyGen presenter clips for a film's presenter-mode scenes, each
 * lip-synced to the scene's generated narration MP3.
 *
 * Usage: HEYGEN_API_KEY=... node scripts/presenter.mjs [films/intro] [--yes]
 *
 * Paid API: prints the clip list and an estimate, then requires --yes (the
 * cost-gate discipline the Scenar presenter pipeline established). Clips are
 * cached by narration MP3 bytes — re-narrating a scene invalidates its clip
 * automatically, nothing else regenerates.
 *
 * Writes assets/presenter/<scene-id>.mp4 + assets/presenter/manifest.json.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const filmDir = resolve(root, process.argv[2] ?? "films/intro");
const confirmed = process.argv.includes("--yes");

const apiKey = process.env.HEYGEN_API_KEY;
if (!apiKey) {
  console.error("HEYGEN_API_KEY is required (planton secret get heygen-api-key --ignore-env -o json)");
  process.exit(1);
}
// Cast at the owner casting gate (2026-09-02): Abigail, native 1920x1080.
const avatarId = process.env.HEYGEN_AVATAR_ID ?? "Abigail_standing_office_front";

const manifest = JSON.parse(readFileSync(join(filmDir, "manifest.json"), "utf8"));
const narrDir = join(root, "assets", "narration");
const outDir = join(root, "assets", "presenter");
mkdirSync(outDir, { recursive: true });
const outManifestPath = join(outDir, "manifest.json");
const prev = existsSync(outManifestPath) ? JSON.parse(readFileSync(outManifestPath, "utf8")) : {};
const narrManifest = JSON.parse(readFileSync(join(narrDir, "manifest.json"), "utf8"));

const api = async (url, { json, body, headers } = {}) => {
  const res = await fetch(url, {
    method: json || body ? "POST" : "GET",
    headers: {
      "X-Api-Key": apiKey,
      ...(json ? { "Content-Type": "application/json" } : {}),
      ...(headers ?? {}),
    },
    body: json ? JSON.stringify(json) : body,
  });
  if (!res.ok) {
    throw new Error(`${url}: HTTP ${res.status} ${await res.text()}`);
  }
  return res.json();
};

const scenes = manifest.scenes.filter((s) => s.mode === "presenter");
const work = [];
for (const scene of scenes) {
  const mp3 = readFileSync(join(narrDir, `${scene.id}.mp3`));
  const audioHash = createHash("sha256").update(mp3).update(avatarId).digest("hex").slice(0, 16);
  const mp4Path = join(outDir, `${scene.id}.mp4`);
  if (prev[scene.id]?.audioHash === audioHash && existsSync(mp4Path)) {
    console.log(`cached    ${scene.id}`);
    continue;
  }
  work.push({ scene, mp3, audioHash });
}

if (work.length === 0) {
  console.log("done: 0 generated, all cached");
  process.exit(0);
}

const totalSec = work.reduce((a, w) => a + narrManifest[w.scene.id].durationMs / 1000, 0);
console.log(`will generate ${work.length} clip(s) with avatar ${avatarId}, ~${totalSec.toFixed(0)}s of video`);
console.log(`estimated cost: ~$${(totalSec * 0.03).toFixed(2)} (observed ~$0.01-0.03/s on prior runs)`);
if (!confirmed) {
  console.log("pass --yes to proceed (paid API)");
  process.exit(2);
}

const next = { ...prev };
const pending = {};
for (const { scene, mp3, audioHash } of work) {
  const up = await api("https://upload.heygen.com/v1/asset", {
    body: mp3,
    headers: { "Content-Type": "audio/mpeg" },
  });
  const assetId = up.data.asset_id ?? up.data.id;
  const gen = await api("https://api.heygen.com/v2/video/generate", {
    json: {
      video_inputs: [
        {
          character: { type: "avatar", avatar_id: avatarId, avatar_style: "normal" },
          voice: { type: "audio", audio_asset_id: assetId },
        },
      ],
      dimension: { width: manifest.width, height: manifest.height },
    },
  });
  pending[scene.id] = { videoId: gen.data.video_id, audioHash };
  console.log(`submitted ${scene.id}: ${gen.data.video_id}`);
}

const deadline = Date.now() + 30 * 60 * 1000;
while (Object.keys(pending).length > 0 && Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 20000));
  for (const [sceneId, p] of Object.entries(pending)) {
    const st = await api(`https://api.heygen.com/v1/video_status.get?video_id=${p.videoId}`);
    const status = st.data.status;
    if (status === "completed") {
      const clip = await fetch(st.data.video_url);
      writeFileSync(join(outDir, `${sceneId}.mp4`), Buffer.from(await clip.arrayBuffer()));
      next[sceneId] = { audioHash: p.audioHash };
      delete pending[sceneId];
      console.log(`DONE ${sceneId}`);
    } else if (status === "failed") {
      console.error(`FAILED ${sceneId}: ${JSON.stringify(st.data.error)}`);
      delete pending[sceneId];
      process.exitCode = 1;
    } else {
      console.log(`... ${sceneId}: ${status}`);
    }
  }
}
if (Object.keys(pending).length > 0) {
  console.error("TIMEOUT waiting for:", Object.keys(pending));
  process.exit(1);
}
writeFileSync(outManifestPath, JSON.stringify(next, null, 2) + "\n");
console.log("done");
