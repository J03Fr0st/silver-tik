import puppeteer, { Page, Browser } from 'puppeteer';
import { config } from 'dotenv';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TIKTOK_URL = 'https://www.tiktok.com/login/phone-or-email/email';
const OUTPUT_FILE = 'followers.json';

interface Follower {
    username: string;
    nickname: string;
    profileUrl: string;
}

async function saveToFile(followers: Follower[]): Promise<void> {
    await fs.writeFile(
        path.join(process.cwd(), OUTPUT_FILE),
        JSON.stringify(followers, null, 2)
    );
    console.log(`Saved ${followers.length} followers to ${OUTPUT_FILE}`);
}

async function login(page: Page): Promise<void> {
    console.log('Attempting to log in...');
    
    // Wait for the email input field and type the email
    await page.waitForSelector('input[name="username"]');
    await page.type('input[name="username"]', process.env.TIKTOK_EMAIL || '');
    
    // Wait for the password input field and type the password
    await page.waitForSelector('input[type="password"]');
    await page.type('input[type="password"]', process.env.TIKTOK_PASSWORD || '');
    
    // Click the login button
    await page.waitForSelector('button[type="submit"]');
    await page.click('button[type="submit"]');
    
    // Wait for navigation to complete after login
    console.log('Waiting for login to complete...');
    await page.waitForNavigation({
        waitUntil: 'networkidle0',
        timeout: 60000
    });
    
    console.log('Login successful!');
}

async function scrapeFollowers(): Promise<void> {
    const browser: Browser = await puppeteer.launch({
        headless: false,
        defaultViewport: null
    });

    try {
        const page: Page = await browser.newPage();
        
        // Navigate to TikTok login page
        console.log('Navigating to TikTok login page...');
        await page.goto(TIKTOK_URL);
        
        // Check if we have the required environment variables
        if (!process.env.TIKTOK_EMAIL || !process.env.TIKTOK_PASSWORD || !process.env.TIKTOK_USERNAME) {
            throw new Error('Missing required environment variables. Please check your .env file');
        }

        // Attempt to login
        await login(page);

        // Navigate to the followers page
        const targetUsername = process.env.TARGET_USERNAME || process.env.TIKTOK_USERNAME;
        console.log(`Navigating to @${targetUsername}'s followers page...`);
        await page.goto(`https://www.tiktok.com/@${targetUsername}/followers`);
        
        const followers: Follower[] = [];
        
        // Wait for the followers list to load
        console.log('Waiting for followers list to load...');
        await page.waitForSelector('.tiktok-follower-item', { timeout: 10000 });
        
        let previousHeight = 0;
        let scrollAttempts = 0;
        const maxScrollAttempts = 50; // Adjust this value to control how many times to scroll
        
        while (scrollAttempts < maxScrollAttempts) {
            const followerElements = await page.$$('.tiktok-follower-item');
            
            for (const element of followerElements) {
                try {
                    const username = await element.$eval('.username', (el) => (el as HTMLElement).textContent?.trim() || '');
                    const nickname = await element.$eval('.nickname', (el) => (el as HTMLElement).textContent?.trim() || '');
                    const profileUrl = await element.$eval('a', (el) => (el as HTMLAnchorElement).href);
                    
                    // Only add if not already in the list
                    if (!followers.some(f => f.username === username)) {
                        followers.push({ username, nickname, profileUrl });
                        console.log(`Found follower: ${username}`);
                    }
                } catch (error) {
                    console.warn('Failed to extract follower data:', error);
                    continue;
                }
            }
            
            // Scroll down
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await page.waitForTimeout(1000); // Wait for new content to load
            
            const newHeight = await page.evaluate(() => document.body.scrollHeight);
            if (newHeight === previousHeight) {
                console.log('Reached end of followers list');
                break; // No new content loaded
            }
            
            previousHeight = newHeight;
            scrollAttempts++;
            
            console.log(`Scraped ${followers.length} followers so far...`);
        }
        
        await saveToFile(followers);
        console.log('Scraping completed successfully!');
        
    } catch (error) {
        console.error('An error occurred:', error);
        throw error;
    } finally {
        await browser.close();
    }
}

scrapeFollowers().catch(console.error);
