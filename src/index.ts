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
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    this.page = await this.browser.newPage();
    await this.page.setViewport({ width: 1280, height: 800 });
  }

  async login(username: string, password: string): Promise<boolean> {
    if (!this.page) throw new Error("Browser not initialized");

    try {
      console.log("🔑 Logging in to TikTok...");
      await this.page.goto("https://www.tiktok.com/login/phone-or-email/email");
      
      // Wait for login frame and switch to it
      const loginFrame = await this.page.waitForSelector('iframe[src*="login_dialog"]');
      if (!loginFrame) throw new Error("Login frame not found");
      
      const frame = await loginFrame.contentFrame();
      if (!frame) throw new Error("Could not switch to login frame");

      // Click login with email/username
      await frame.waitForSelector('[data-e2e="login-email-button"]');
      await frame.click('[data-e2e="login-email-button"]');

      // Fill in credentials
      await frame.waitForSelector('[data-e2e="email-username-input"]');
      await frame.type('[data-e2e="email-username-input"]', username);
      await frame.type('[data-e2e="password-input"]', password);

      // Click login button
      await frame.click('[data-e2e="login-button"]');

      // Wait for navigation to complete
      await this.page.waitForNavigation({ waitUntil: 'networkidle0' });
      
      // Handle CAPTCHA if present
      if (await this.page.$('.secsdk-captcha-drag-icon')) {
        await this.handleCaptcha();
      }

      // Handle any popups
      await this.handlePopups();

      return true;
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
      
      // Try clicking following count first
      try {
        const followingCountSelector = '[data-e2e="following-count"]';
        await this.page.waitForSelector(followingCountSelector, { timeout: 10000 });
        await this.page.click(followingCountSelector);
      } catch (error) {
        console.log("Couldn't click following count, trying direct navigation...");
        await this.page.goto(`https://www.tiktok.com/@${username}/following`);
      }

      // Wait for following list to load
      console.log("Waiting for following list to load...");
      try {
        await this.page.waitForSelector('[data-e2e="user-card"]', { timeout: 15000 });
      } catch (error) {
        console.log("Trying alternative selector...");
        await this.page.waitForSelector('.user-card', { timeout: 5000 });
      }

      const following: Follower[] = [];
      let previousHeight = 0;
      let attempts = 0;
      let noNewFollowingCount = 0;

      // Scroll to load all following
      while (attempts < 20 && noNewFollowingCount < 3) {
        const currentHeight = await this.page.evaluate(() => document.body.scrollHeight);
        
        if (currentHeight === previousHeight) {
          noNewFollowingCount++;
          await this.page.waitForTimeout(2000);
          continue;
        }

        noNewFollowingCount = 0;
        previousHeight = currentHeight;
        
        await this.page.evaluate(() => {
          window.scrollTo(0, document.body.scrollHeight);
        });
        
        await this.page.waitForTimeout(2000);

        // Extract following data
        const newFollowing = await this.page.evaluate(() => {
          const items = Array.from(document.querySelectorAll('[data-e2e="user-card"], .user-card'));
          return items.map(item => {
            const link = item.querySelector('a');
            const href = link?.href || '';
            const username = href.split('/@')[1] || '';
            return {
              username,
              profileUrl: href
            };
          });
        });

        // Update following list and remove duplicates
        const uniqueFollowing = Array.from(
          new Map([...following, ...newFollowing].map((f) => [f.username, f])).values()
        );
        following.splice(0, following.length, ...uniqueFollowing);
        
        console.log(`Found ${following.length} following so far...`);
        attempts++;
      }

      return following;
    } catch (error) {
      console.error("Failed to scrape following:", error);
      await this.page.screenshot({ path: 'debug-following-page.png' });
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
  }
}

main().catch(console.error);
