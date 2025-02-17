import puppeteer from "puppeteer-extra";
import { Page, Browser } from "puppeteer";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import fs from "node:fs";
import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

config();

puppeteer.use(StealthPlugin());

interface Follower {
  username: string;
  profileUrl: string;
}

class TikTokScraper {
  private browser: Browser | null = null;
  private page: Page | null = null;

  async init(): Promise<void> {
    this.browser = await puppeteer.launch({
      headless: false,
      executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--disable-infobars",
        "--window-size=1280,800",
        "--start-maximized"
      ],
      defaultViewport: null,
      ignoreDefaultArgs: ["--enable-automation"]
    });

    this.page = await this.browser.newPage();
    
    // Randomize viewport size slightly
    const width = 1280 + Math.floor(Math.random() * 100);
    const height = 800 + Math.floor(Math.random() * 100);
    await this.page.setViewport({ width, height });
    
    // Set a more realistic user agent
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
    ];
    await this.page.setUserAgent(userAgents[Math.floor(Math.random() * userAgents.length)]);
    
    // Set extra headers to appear more like a real browser
    await this.page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br'
    });

    // Inject scripts to mask automation
    await this.page.evaluateOnNewDocument(() => {
      // Pass the Webdriver Test
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      
      // Pass the Chrome Test
      window.chrome = {
        runtime: {}
      };
      
      // Pass the Permissions Test
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters: any) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission }) :
          originalQuery(parameters)
      );

      // Pass the Plugins Length Test
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5]
      });

      // Pass the Languages Test
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en']
      });
    });

    // Enable stealth mode
    await this.page.setJavaScriptEnabled(true);
  }

  async login(username: string, password: string): Promise<boolean> {
    if (!this.page) throw new Error("Browser not initialized");

    try {
      console.log("🔑 Logging in to TikTok...");
      // Open the email login page directly in the browser
      await this.page.goto("https://www.tiktok.com/login/phone-or-email/email", {
        waitUntil: 'networkidle0'
      });
      
      // Wait for and click the "Use phone / email / username" button
      await this.page.waitForSelector('[data-e2e="type-select-input"]');
      await this.page.click('[data-e2e="type-select-input"]');
      
      // Wait for login form
      await this.page.waitForTimeout(2000);
      
      // Type username and password
      await this.page.type('[data-e2e="email-username-input"]', username);
      await this.page.type('[data-e2e="password-input"]', password);
      
      // Click login button
      await this.page.click('[data-e2e="login-button"]');

      // Wait for navigation to complete
      await this.page.waitForNavigation({ 
        waitUntil: 'networkidle0',
        timeout: 60000
      });
      
      // Handle CAPTCHA if present
      if (await this.page.$('.secsdk-captcha-drag-icon')) {
        await this.handleCaptcha();
      }

      // Handle any popups
      await this.handlePopups();

      // Verify login success
      const loggedIn = await this.page.evaluate(() => {
        return !document.querySelector('[data-e2e="login-button"]');
      });

      if (loggedIn) {
        console.log("✅ Successfully logged in!");
        return true;
      } else {
        console.log("❌ Login failed - still on login page");
        return false;
      }
    } catch (error) {
      console.error("Login failed:", error);
      return false;
    }
  }

  private async handleCaptcha(): Promise<boolean> {
    if (!this.page) throw new Error("Browser not initialized");

    try {
      console.log("⚠️ Please solve the CAPTCHA manually in the browser window");
      await this.page.waitForFunction(
        () => !document.querySelector('.secsdk-captcha-drag-icon'),
        { timeout: 60000 }
      );
      console.log("✅ CAPTCHA verification completed!");
      return true;
    } catch (error) {
      console.log("❌ CAPTCHA verification failed or timed out");
      return false;
    }
  }

  private async handlePopups(): Promise<void> {
    if (!this.page) throw new Error("Browser not initialized");

    try {
      // Handle recharge offer popup
      console.log("Checking for recharge popup...");
      const notNowButton = await this.page.waitForSelector('button.TUXButton.TUXButton--default.TUXButton--large.TUXButton--secondary', { timeout: 5000 });
      if (notNowButton) {
        console.log("Found recharge popup, clicking 'Not Now'...");
        await notNowButton.click();
        await this.page.waitForTimeout(2000);
      }

      // Handle follow requests popup
      const followPopup = await this.page.$('div:has-text("requested to follow you")');
      if (followPopup) {
        const closeButton = await followPopup.$('button[aria-label="Close"]');
        if (closeButton) {
          await closeButton.click();
          await this.page.waitForTimeout(1000);
        }
      }
    } catch (error) {
      console.log("No popups found or already handled");
    }
  }

  async navigateToProfile(target: string): Promise<boolean> {
    if (!this.page) throw new Error("Browser not initialized");

    try {
      console.log("Navigating to profile page...");
      
      // Try clicking profile button with exact class names
      try {
        await this.page.goto(`https://www.tiktok.com/@${target}`);
        await this.page.waitForTimeout(3000);
      } catch (error) {
        console.log("Couldn't click profile button, trying alternative navigation...");
        // Try clicking by aria label      
      }

      // Verify we're on the correct profile or navigate directly
      const currentUrl = this.page.url();
      if (!currentUrl.includes(`/@${target}`)) {
        console.log("Directly navigating to profile URL...");
        await this.page.goto(`https://www.tiktok.com/@${target}`);
        await this.page.waitForTimeout(3000);
      }

      return true;
    } catch (error) {
      console.error("Failed to navigate to profile:", error);
      return false;
    }
  }

  async scrapeFollowing(username: string): Promise<Follower[]> {
    if (!this.page) throw new Error("Browser not initialized");

    try {
      console.log("Navigating to following list...");
      
      // Navigate directly to following page
      await this.page.goto(`https://www.tiktok.com/@${username}/following`);
      await this.page.waitForTimeout(3000);

      // Wait for following list to load
      console.log("Waiting for following list to load...");
      let userCardSelector = '[data-e2e="user-card"]';
      try {
        await this.page.waitForSelector(userCardSelector, { timeout: 15000 });
      } catch (error) {
        console.log("Trying alternative selector...");
        userCardSelector = '.user-card';
        await this.page.waitForSelector(userCardSelector, { timeout: 5000 });
      }

      const following: Follower[] = [];
      let previousHeight = 0;
      let attempts = 0;
      let noNewFollowingCount = 0;

      // Scroll to load all following
      while (attempts < 20 && noNewFollowingCount < 3) {
        const newFollowing = await this.page.evaluate((selector) => {
          const items = Array.from(document.querySelectorAll(selector));
          return items.map(item => {
            const link = item.querySelector('a');
            const href = link?.href || '';
            const username = href.split('/@')[1] || '';
            return {
              username,
              profileUrl: href
            };
          });
        }, userCardSelector);

        // Add new unique following
        for (const user of newFollowing) {
          if (!following.some(f => f.username === user.username)) {
            following.push(user);
          }
        }

        // Scroll down
        await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await this.page.waitForTimeout(2000);

        const currentHeight = await this.page.evaluate(() => document.body.scrollHeight);
        if (currentHeight === previousHeight) {
          noNewFollowingCount++;
        } else {
          noNewFollowingCount = 0;
        }
        previousHeight = currentHeight;
        attempts++;

        console.log(`Found ${following.length} following so far...`);
      }

      return following;
    } catch (error) {
      console.error("Failed to scrape following:", error);
      return [];
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }
}

async function main() {
  const username = process.env.TIKTOK_USERNAME;
  const password = process.env.TIKTOK_PASSWORD;
  const targetUsername = process.env.TARGET_USERNAME;

  if (!username || !password || !targetUsername) {
    throw new Error("Please set TIKTOK_USERNAME, TIKTOK_PASSWORD, and TARGET_USERNAME in your .env file");
  }

  const scraper = new TikTokScraper();
  
  try {
    await scraper.init();
    console.log("Browser initialized");

    const loggedIn = await scraper.login(username, password);
    if (!loggedIn) {
      throw new Error("Failed to log in");
    }
    console.log("Successfully logged in");

    const navigated = await scraper.navigateToProfile(targetUsername);
    if (!navigated) {
      throw new Error("Failed to navigate to profile");
    }
    console.log("Successfully navigated to profile");

    const following = await scraper.scrapeFollowing(targetUsername);
    console.log(`Scraped ${following.length} following accounts`);
    
    // Save results to file
    const outputPath = path.join(__dirname, '..', 'following.json');
    fs.writeFileSync(outputPath, JSON.stringify(following, null, 2));
    console.log(`Results saved to ${outputPath}`);
  } catch (error) {
    console.error("Error during scraping:", error);
    throw error;
  } finally {
    await scraper.close();
  }
}

main().catch(console.error);
