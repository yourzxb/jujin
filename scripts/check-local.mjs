for (const url of ['/api/health', '/brand.svg', '/source/project-review.md', '/api/ai/config', '/source/resource-directory.md', '/source/china-resources.md', '/source/github-projects.md', '/app.js']) {
  const response = await fetch('http://127.0.0.1:8765' + url, { signal: AbortSignal.timeout(5000) });
  console.log(url, response.status);
  if (!response.ok) process.exitCode = 1;
}
