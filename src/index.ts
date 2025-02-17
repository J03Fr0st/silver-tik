import puppeteer, { Page } from 'puppeteer';
import { config } from 'dotenv';
import fs from 'fs/promises';
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

async function scrapeFollowers(): Promise<void> {
    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: null
    });

    try {
        const page: Page = await browser.newPage();
        
        // Navigate to TikTok login page
        await page.goto(TIKTOK_URL);
        
        console.log('Please log in to your TikTok account...');
        // Wait for navigation to complete after login
        await page.waitForNavigation({
            waitUntil: 'networkidle0',
            timeout: 60000
        });

        if (!process.env.TIKTOK_USERNAME) {
            throw new Error('TIKTOK_USERNAME environment variable is not set');
        }

        // Navigate to the followers page
        await page.goto(`https://www.tiktok.com/@${process.env.TIKTOK_USERNAME}/followers`);
        
        const followers: Follower[] = [];
        
        // Wait for the followers list to load
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
