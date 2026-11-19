import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'tests/browser',use:{headless:true,launchOptions:{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}},projects:[
 {name:'demo',testIgnore:['accounts-auth.spec.ts','room-data.spec.ts'],use:{baseURL:'http://127.0.0.1:5173'}},
 {name:'accounts',testMatch:['accounts-auth.spec.ts','room-data.spec.ts'],use:{baseURL:'http://127.0.0.1:5174'}}
],webServer:[
 {command:'npm run dev -- --port 5173',url:'http://127.0.0.1:5173',reuseExistingServer:!process.env.CI,env:{VITE_SUPABASE_URL:'',VITE_SUPABASE_ANON_KEY:''}},
 {command:'npm run dev -- --port 5174',url:'http://127.0.0.1:5174',reuseExistingServer:!process.env.CI,env:{VITE_SUPABASE_URL:'http://127.0.0.1:54321',VITE_SUPABASE_ANON_KEY:'test-public-key'}}
],reporter:'list'});
