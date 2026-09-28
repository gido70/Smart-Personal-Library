import { execFileSync } from 'node:child_process';

const [base, head = 'HEAD'] = process.argv.slice(2);
if (!base || /^0+$/.test(base)) {
  console.error('Index sync: a valid comparison base is required.');
  process.exit(1);
}
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
try {
  git('rev-parse', '--verify', `${base}^{commit}`);
  git('rev-parse', '--verify', `${head}^{commit}`);
  const changed = git('diff', '--name-only', base, head).split('\n').filter(Boolean);
  const platform = changed.filter(path => /^(src\/|public\/|supabase\/|scripts\/|\.github\/workflows\/|package(?:-lock)?\.json$|vite\.config\.|tsconfig|index\.html$|AGENTS\.md$)/.test(path));
  const index = 'docs/concept-index-v1.1.html';
  if (platform.length && !changed.includes(index)) {
    throw new Error(`Platform changes require a matching project-index update in the same change:\n${platform.join('\n')}\nUpdate ${index} with behavior, deployment status and verification limits.`);
  }
  // Deleting the index must never satisfy the update requirement.
  const html = git('show', `${head}:${index}`);
  for (const marker of ['id="change-register"', 'id="technical-journey"', 'dir="rtl"']) {
    if (!html.includes(marker)) throw new Error(`Required index structure missing: ${marker}`);
  }
  console.log(`Index sync passed: ${platform.length} platform files; index ${changed.includes(index) ? 'updated' : 'unchanged (no platform changes)'}. Content accuracy still requires review.`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
