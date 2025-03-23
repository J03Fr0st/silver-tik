import puppeteer, { Page, Browser } from 'puppeteer';
import { config } from 'dotenv';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

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

// Add a helper function to prompt for user input during CAPTCHA
function waitForUserInput(message: string): Promise<void> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise(resolve => {
        rl.question(`${message} (Press Enter to continue)`, () => {
            rl.close();
            resolve();
        });
    });
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
    
    // Wait for manual CAPTCHA completion
    console.log('CAPTCHA detected. Please complete it manually in the browser window.');
    
    // Take a screenshot to help identify the CAPTCHA state
    await page.screenshot({ path: 'captcha-screen.png' });
    console.log('Screenshot saved to captcha-screen.png');
    
    // Wait for user to complete CAPTCHA manually
    await waitForUserInput('Complete the CAPTCHA in the browser window, then press Enter to continue...');
    
    console.log('Continuing after CAPTCHA completion...');
    
    // Give some time for the page to update after CAPTCHA
    await page.waitForTimeout(5000);
    
    // Take another screenshot to confirm the logged-in state
    await page.screenshot({ path: 'post-captcha-screen.png' });
    
    console.log('Login process completed!');
}

async function scrapeFollowers(): Promise<void> {
    const browser: Browser = await puppeteer.launch({
        headless: false,
        defaultViewport: { width: 1280, height: 800 },
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

        // Navigate to the user's profile page
        const targetUsername = process.env.TARGET_USERNAME || process.env.TIKTOK_USERNAME;
        console.log(`Navigating to @${targetUsername}'s profile page...`);
        await page.goto(`https://www.tiktok.com/@${targetUsername}`, { waitUntil: 'networkidle2' });
        
        // Wait for the profile page to load
        console.log('Waiting for profile page to load...');
        await page.waitForTimeout(5000);
        
        // Take a screenshot of the profile page for debugging
        await page.screenshot({ path: 'profile-page.png' });
        
        // Now click on the "Following" button/link to view the following list
        console.log('Clicking on the "Following" section...');
        
        // Try different selectors for the "Following" button based on TikTok's interface
        const followingSelectors = [
            // Selectors based on the screenshot
            'span[data-e2e="following"]',
            'strong[title="Following"]',
            'div[class*="css-1ldzp5s-DivNumber"] span[data-e2e="following"]',
            'div:has(> strong[title="Following"])',
            'div:has(span[data-e2e="following"])',
            // More generic selectors
            '[data-e2e="following"], [data-e2e="following-count"]',
            '.css-1hig5p8-SpanUnit[data-e2e="following"]',
            // Try the parent elements that might be clickable
            'div[class*="css-1ldzp5s-DivNumber"]:has(span[data-e2e="following"])'
        ];
        
        let followingClicked = false;
        for (const selector of followingSelectors) {
            try {
                console.log(`Trying to click following selector: ${selector}`);
                const followingElement = await page.$(selector);
                if (followingElement) {
                    // Take a screenshot to see what we're about to click
                    await page.screenshot({ path: 'before-click-following.png' });
                    
                    // Log the element we found
                    const elementInfo = await page.evaluate(el => {
                        return {
                            tagName: el.tagName,
                            classes: el.className,
                            text: el.textContent,
                            rect: el.getBoundingClientRect()
                        };
                    }, followingElement);
                    console.log('Found following element:', elementInfo);
                    
                    await followingElement.click();
                    console.log(`Clicked on following element with selector: ${selector}`);
                    followingClicked = true;
                    
                    // Wait for the following list to load
                    await page.waitForTimeout(5000);
                    
                    // Take a screenshot after clicking
                    await page.screenshot({ path: 'after-click-following.png' });
                    break;
                }
            } catch (error: any) {
                console.warn(`Failed to click following with selector ${selector}:`, error.message);
            }
        }
        
        if (!followingClicked) {
            console.log('Could not find or click the Following button using standard selectors.');
            console.log('Trying alternative approach by evaluating in page context...');
            
            // Try a more direct approach based on the visible structure in the screenshot
            try {
                // First attempt: Look specifically for the number and text structure we can see in the screenshot
                const clickedFollowing = await page.evaluate(() => {
                    // Looking for the strong element with title="Following" and containing text "8021"
                    const followingStrongElements = Array.from(document.querySelectorAll('strong[title="Following"]'));
                    
                    for (const el of followingStrongElements) {
                        if (el.textContent && el.textContent.includes('Following')) {
                            console.log('Found Following element by content:', el.textContent);
                            // Click the parent if it's likely to be clickable
                            const clickTarget = el.closest('div') || el;
                            clickTarget.dispatchEvent(new MouseEvent('click', {
                                bubbles: true,
                                cancelable: true,
                                view: window
                            }));
                            return true;
                        }
                    }
                    
                    // Try to find elements with the specific class names from the screenshot
                    const divNumberElements = document.querySelectorAll('div[class*="css-1ldzp5s-DivNumber"]');
                    for (const el of Array.from(divNumberElements)) {
                        if (el.textContent && el.textContent.includes('Following')) {
                            console.log('Found Following element by div class:', el.textContent);
                            el.dispatchEvent(new MouseEvent('click', {
                                bubbles: true,
                                cancelable: true,
                                view: window
                            }));
                            return true;
                        }
                    }
                    
                    return false;
                });
                
                if (clickedFollowing) {
                    console.log('Successfully clicked on Following element using direct approach');
                    followingClicked = true;
                    await page.waitForTimeout(5000);
                    await page.screenshot({ path: 'after-direct-click-following.png' });
                }
            } catch (error: any) {
                console.warn('Failed with direct approach:', error.message);
            }
            
            // If still not clicked, try the more generic approach
            if (!followingClicked) {
                try {
                    await page.evaluate(() => {
                        // Try to find elements by their text content
                        const elements = Array.from(document.querySelectorAll('strong, span, div'));
                        const followingElement = elements.find(el => 
                            el.textContent?.includes('Following') && 
                            el.closest('a, button, [role="button"]')
                        );
                        
                        if (followingElement) {
                            const clickTarget = followingElement.closest('a, button, [role="button"]') || followingElement;
                            // Use dispatchEvent for broader compatibility
                            clickTarget.dispatchEvent(new MouseEvent('click', {
                                bubbles: true,
                                cancelable: true,
                                view: window
                            }));
                            return true;
                        }
                        return false;
                    });
                    
                    console.log('Attempted to click Following via JavaScript evaluation');
                    await page.waitForTimeout(5000);
                    await page.screenshot({ path: 'after-js-click-following.png' });
                } catch (error: any) {
                    console.warn('Failed to click Following via JavaScript evaluation:', error.message);
                }
            }
            
            // If all click attempts failed, try direct URL navigation as a last resort
            if (!followingClicked) {
                console.log('All click attempts failed. Trying direct URL navigation...');
                const targetUsername = process.env.TARGET_USERNAME || process.env.TIKTOK_USERNAME;
                
                // Direct navigation to the following page
                await page.goto(`https://www.tiktok.com/@${targetUsername}/following`, { waitUntil: 'networkidle2' });
                console.log(`Directly navigated to @${targetUsername}/following URL`);
                
                // Take a screenshot after direct navigation
                await page.screenshot({ path: 'direct-navigation-following.png' });
                await page.waitForTimeout(5000);
            }
        }
        
        // Wait longer for the following list to load
        console.log('Waiting for following list to load...');
        await page.waitForTimeout(10000);
        
        // Take a final screenshot before starting to extract followers
        await page.screenshot({ path: 'before-extraction.png' });
        
        const followers: Follower[] = [];
        
        // After navigating to followers page and waiting
        console.log('Looking for follower elements...');
        
        // Try different selectors that might match TikTok follower items
        const possibleSelectors = [
            '.tiktok-follower-item',
            '.user-list-item',
            '[data-e2e="user-item"]',
            '.tiktok-x6f6za-DivUserContainer',
            '.tiktok-1ilikj2-DivShareUserContainer'
        ];
        
        let followerSelector = '';
        for (const selector of possibleSelectors) {
            console.log(`Trying selector: ${selector}`);
            const exists = await page.$(selector) !== null;
            if (exists) {
                console.log(`Found matching selector: ${selector}`);
                followerSelector = selector;
                break;
            }
        }
        
        if (!followerSelector) {
            console.log('Could not find any follower elements with known selectors.');
            console.log('Taking screenshot for debugging purposes...');
            await page.screenshot({ path: 'followers-page-debug.png' });
            console.log('Please check the followers-page-debug.png file to see the current page state.');
            
            // Try to continue with a generic approach
            followerSelector = 'a[href*="@"]'; // Try to find user links
        }
        
        let previousHeight = 0;
        let scrollAttempts = 0;
        const maxScrollAttempts = 50; // Adjust this value to control how many times to scroll
        
        while (scrollAttempts < maxScrollAttempts) {
            const followerElements = await page.$$(followerSelector);
            console.log(`Found ${followerElements.length} follower elements with selector: ${followerSelector}`);
            
            if (followerElements.length === 0 && scrollAttempts > 0) {
                // Take a screenshot before retrying with different approach
                await page.screenshot({ path: `no-followers-found-${scrollAttempts}.png` });
                console.log('No follower elements found. Trying a different approach...');
                
                // Try to find any links that might be user profiles
                const userLinks = await page.$$('a[href*="@"]');
                for (const link of userLinks) {
                    try {
                        const href = await page.evaluate(el => el.href, link);
                        const username = href.split('@')[1]?.split('/')[0] || '';
                        
                        if (username && !followers.some(f => f.username === username)) {
                            const nickname = await page.evaluate(el => {
                                // Try to get the closest text element that might be a name
                                const textEl = el.querySelector('span') || el;
                                return textEl.textContent?.trim() || '';
                            }, link);
                            
                            followers.push({
                                username,
                                nickname: nickname || username,
                                profileUrl: href
                            });
                            console.log(`Found follower via link: ${username}`);
                        }
                    } catch (error) {
                        console.warn('Failed to extract follower from link:', error);
                        continue;
                    }
                }
            }
            
            // Original follower extraction logic
            for (const element of followerElements) {
                try {
                    // Try various ways to extract username and nickname
                    let username = '';
                    let nickname = '';
                    let profileUrl = '';
                    
                    try {
                        username = await element.$eval('.username, [data-e2e="user-username"], span[data-e2e="user-subtitle"]', 
                            (el) => (el as HTMLElement).textContent?.trim().replace('@', '') || '');
                    } catch (e) {
                        // If specific selectors fail, try to get any text that looks like a username
                        const allText = await page.evaluate(el => {
                            return Array.from(el.querySelectorAll('*'))
                                .map(node => (node as HTMLElement).innerText)
                                .join(' ');
                        }, element);
                        
                        // Look for @ pattern in text
                        const match = allText.match(/@([a-zA-Z0-9._]+)/);
                        if (match) {
                            username = match[1];
                        }
                    }
                    
                    try {
                        nickname = await element.$eval('.nickname, [data-e2e="user-nickname"], span[data-e2e="user-title"]', 
                            (el) => (el as HTMLElement).textContent?.trim() || '');
                    } catch (e) {
                        // Use username as fallback
                        nickname = username;
                    }
                    
                    try {
                        profileUrl = await element.$eval('a', (el) => (el as HTMLAnchorElement).href);
                    } catch (e) {
                        // Build URL from username if possible
                        if (username) {
                            profileUrl = `https://www.tiktok.com/@${username}`;
                        }
                    }
                    
                    // Only add if we have a username and it's not already in the list
                    if (username && !followers.some(f => f.username === username)) {
                        followers.push({ username, nickname, profileUrl });
                        console.log(`Found follower: ${username}`);
                    }
                } catch (error) {
                    console.warn('Failed to extract follower data:', error);
                    continue;
                }
            }
            
            // Scroll down with improved handling
            console.log(`Scroll attempt ${scrollAttempts + 1}/${maxScrollAttempts}`);
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            
            // Increase wait time between scrolls to allow content to load
            await page.waitForTimeout(2000);
            
            // Check if we've reached the end of the content
            const newHeight = await page.evaluate(() => document.body.scrollHeight);
            if (newHeight === previousHeight) {
                console.log('No new content loaded after scrolling. Trying one more time...');
                
                // Try one more scroll with additional wait time before giving up
                await page.waitForTimeout(3000);
                await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
                await page.waitForTimeout(3000);
                
                const finalHeight = await page.evaluate(() => document.body.scrollHeight);
                if (finalHeight === newHeight) {
                    console.log('Reached end of followers list');
                    break; // No new content loaded after second attempt
                }
            }
            
            previousHeight = newHeight;
            scrollAttempts++;
            
            console.log(`Scraped ${followers.length} followers so far...`);
            
            // Take periodic screenshots to help with debugging if needed
            if (scrollAttempts % 10 === 0) {
                await page.screenshot({ path: `followers-scroll-${scrollAttempts}.png` });
            }
        }
        
        if (followers.length === 0) {
            console.log('No followers were found. Taking a final screenshot for debugging.');
            await page.screenshot({ path: 'no-followers-found.png' });
        } else {
            await saveToFile(followers);
            console.log('Scraping completed successfully!');
        }
        
    } catch (error) {
        console.error('An error occurred:', error);
        
        // Take a screenshot to help with debugging
        try {
            const page = (await browser.pages())[0];
            await page.screenshot({ path: 'error-screenshot.png' });
            console.log('Error screenshot saved to error-screenshot.png');
        } catch (screenshotError) {
            console.error('Failed to take error screenshot:', screenshotError);
        }
        
        throw error;
    } finally {
        await browser.close();
    }
}

// Add a main function with improved error handling
async function main() {
    console.log('Starting TikTok follower scraper...');
    
    try {
        await scrapeFollowers();
        console.log('Script completed successfully!');
    } catch (error) {
        console.error('Script failed with error:', error);
        process.exit(1);
    }
}

// Run the main function
main();
