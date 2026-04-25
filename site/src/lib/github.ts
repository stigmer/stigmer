const profileCache = new Map<string, string>();

export async function getGitHubDisplayName(
  username: string,
): Promise<string> {
  const cached = profileCache.get(username);
  if (cached) return cached;

  try {
    const res = await fetch(`https://api.github.com/users/${username}`);
    if (res.ok) {
      const data = await res.json();
      const name: string = data.name || username;
      profileCache.set(username, name);
      return name;
    }
  } catch {
    // API unavailable — fall back to the handle itself
  }

  profileCache.set(username, username);
  return username;
}
