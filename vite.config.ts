import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { execFileSync } from 'node:child_process';
function buildCommit() {
  if (process.env.COMMIT_REF) return process.env.COMMIT_REF;
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try { return execFileSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8'}).trim(); }
  catch { return 'unknown'; }
}
export default defineConfig({
  plugins:[react(), {
    name:'deployment-metadata',
    apply:'build',
    generateBundle() {
      this.emitFile({type:'asset',fileName:'deployment.json',source:JSON.stringify({
        commit:buildCommit(),builtAt:new Date().toISOString(),
      })});
    },
  }],
  test:{include:['tests/**/*.test.ts']},
});
