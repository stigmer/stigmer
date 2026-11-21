/**
 * The scratch apps a real coding agent works in: Ledgerly, the coding-agent
 * door's Next.js invoicing app (test/install/coding-agent-door.mjs), and
 * Statements, a FastAPI app the app walk (test/install/coding-agent-app.mjs)
 * puts an agent in. Each is a small product with its own stand-in sign-in,
 * committed to a fresh git repository the way a person's project is, so a
 * coding agent meets a real app rather than an empty folder.
 *
 * Each app's files are a pure map (`ledgerlyFiles`, `statementsFiles`), held
 * by lib/scratch-apps.test.mjs; the writers lay them down and commit.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Lays down `files` under `dir` and commits them as `message` to a fresh repository. */
function writeApp(dir, files, message) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["-c", "user.name=door", "-c", "user.email=door@stigmer.test", "commit", "-qm", message], { cwd: dir });
}

/**
 * Ledgerly, the door's scratch app (and the app walk's Next.js one): an invoicing product with its own stand-in sign-in. With
 * `npmrc`, the app routes the @stigmer scope in its own .npmrc, as a
 * consumer of a registry other than npm's does, so the coding agent's
 * installs read the walk's registry.
 */
export function ledgerlyFiles(npmrc) {
  const files = {
    "package.json": JSON.stringify(
      {
        name: "ledgerly",
        private: true,
        scripts: { dev: "next dev", build: "next build", start: "next start" },
        dependencies: { next: "15.5.4", react: "19.1.1", "react-dom": "19.1.1" },
        devDependencies: { typescript: "5.9.3", "@types/react": "19.1.13", "@types/node": "22.18.6" },
      },
      null,
      2,
    ),
    "README.md":
      "# Ledgerly\n\nInvoicing for small wholesalers. Customers upload purchase orders and supplier invoices; Ledgerly matches them and pays the ones that agree.\n\n- `app/invoices`: the invoices page, where a customer reviews what came in.\n- `lib/session.ts`: who is signed in (`getSession()`).\n",
    ".gitignore": "node_modules\n.next\n.env*.local\n",
    "tsconfig.json": JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          lib: ["dom", "dom.iterable", "esnext"],
          strict: true,
          module: "esnext",
          moduleResolution: "bundler",
          jsx: "preserve",
          noEmit: true,
          esModuleInterop: true,
          skipLibCheck: true,
          incremental: true,
          resolveJsonModule: true,
          isolatedModules: true,
          plugins: [{ name: "next" }],
          paths: { "@/*": ["./*"] },
        },
        include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
        exclude: ["node_modules"],
      },
      null,
      2,
    ),
    "lib/session.ts": `import { cookies } from "next/headers";

/** Who is signed in to Ledgerly: the demo sign-in keeps the person in a cookie. */
export interface Session {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
}

export async function getSession(): Promise<Session | null> {
  const value = (await cookies()).get("ledgerly_user")?.value;
  if (value === undefined || value === "") return null;
  return { userId: \`user-\${value}\`, email: \`\${value}@ledgerly.test\`, name: value };
}
`,
    "app/layout.tsx": `export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`,
    "app/page.tsx": `import Link from "next/link";

export default function Home() {
  return (
    <main>
      <h1>Ledgerly</h1>
      <p>
        <Link href="/invoices">Invoices</Link>
      </p>
    </main>
  );
}
`,
    "app/invoices/page.tsx": `import { getSession } from "@/lib/session";

export default async function InvoicesPage() {
  const session = await getSession();
  return (
    <main>
      <h1>Invoices</h1>
      <p>{session === null ? "Sign in at /login?user=<name>." : \`Signed in as \${session.name}.\`}</p>
    </main>
  );
}
`,
    "app/login/route.ts": `import { NextResponse, type NextRequest } from "next/server";

/** The demo sign-in: /login?user=dana signs Dana in and goes to the invoices. */
export function GET(request: NextRequest) {
  const user = request.nextUrl.searchParams.get("user") ?? "";
  const response = NextResponse.redirect(new URL("/invoices", request.url));
  response.cookies.set("ledgerly_user", user);
  return response;
}
`,
  };
  if (npmrc !== undefined) files[".npmrc"] = npmrc;
  return files;
}

/** Writes Ledgerly into `dir` and commits it to a fresh git repository. */
export function writeLedgerly(dir, npmrc) {
  writeApp(dir, ledgerlyFiles(npmrc), "Ledgerly");
}


/**
 * Statements, the app walk's FastAPI app: a customer signs in (the stand-in
 * `/login?user=<name>` keeps them in a cookie, read by `current_user` in
 * `app/session.py`) and uploads a bank statement on `/statements`, which
 * today only stores it. Its README says how it runs: the virtual environment
 * in `.venv`, settings from `.env`.
 */
export function statementsFiles() {
  return {
    "README.md":
      "# Statements\n\nStatement checks for small businesses. A customer signs in, uploads a bank statement (CSV), and Statements keeps it.\n\n- `app/main.py`: the routes; `POST /statements` takes the upload.\n- `app/session.py`: who is signed in (`current_user`).\n\nRun it with the virtual environment in `.venv` and the settings in `.env`:\n\n```bash\n.venv/bin/pip install -r requirements.txt\n.venv/bin/uvicorn app.main:app --env-file .env\n```\n",
    ".gitignore": ".venv\n__pycache__\n.env\nuploads\n",
    "requirements.txt": "fastapi\nuvicorn\npython-multipart\npython-dotenv\n",
    "app/__init__.py": "",
    "app/session.py": `"""Who is signed in to Statements: the demo sign-in keeps the person in a cookie."""

from dataclasses import dataclass

from fastapi import HTTPException, Request


@dataclass(frozen=True)
class User:
    id: str
    email: str
    name: str


def current_user(request: Request) -> User:
    """The signed-in customer, or 401."""
    name = request.cookies.get("statements_user", "")
    if not name:
        raise HTTPException(status_code=401, detail="Sign in at /login?user=<name>.")
    return User(id=f"user-{name}", email=f"{name}@statements.test", name=name)
`,
    "app/main.py": `"""Statements: a customer signs in and uploads a bank statement."""

from pathlib import Path

from fastapi import Depends, FastAPI, UploadFile
from fastapi.responses import PlainTextResponse, RedirectResponse

from app.session import User, current_user

app = FastAPI()
UPLOADS = Path("uploads")


@app.get("/login")
def login(user: str) -> RedirectResponse:
    """The demo sign-in: /login?user=dana signs Dana in."""
    response = RedirectResponse("/statements", status_code=303)
    response.set_cookie("statements_user", user)
    return response


@app.get("/statements", response_class=PlainTextResponse)
def statements_page(user: User = Depends(current_user)) -> str:
    return f"Signed in as {user.name}. POST a CSV to /statements to upload a statement."


@app.post("/statements", response_class=PlainTextResponse)
async def upload_statement(file: UploadFile, user: User = Depends(current_user)) -> str:
    """Keeps the customer's statement."""
    folder = UPLOADS / user.id
    folder.mkdir(parents=True, exist_ok=True)
    (folder / (file.filename or "statement.csv")).write_bytes(await file.read())
    return f"Uploaded {file.filename}."
`,
  };
}

/** Writes Statements into `dir` and commits it to a fresh git repository. */
export function writeStatements(dir) {
  writeApp(dir, statementsFiles(), "Statements");
}
