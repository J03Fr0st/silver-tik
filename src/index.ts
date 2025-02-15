import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import fs from "fs";
import "dotenv/config";

puppeteer.use(StealthPlugin());

interface Follower {
  username: string;
  profileUrl: string;
}

// Function to generate human-like mouse movements
const generateHumanMouseMovements = (startX: number, startY: number, endX: number, endY: number, steps = 100) => {
  const movements = [];
  const baseVelocity = 0.5;
  
  for (let i = 0; i <= steps; i++) {
    // Add some randomness to the path
    const progress = i / steps;
    const phase = progress * Math.PI;
    
    // Add slight curve to movement
    const curve = Math.sin(phase) * 10;
    
    const x = startX + (endX - startX) * progress;
    const y = startY + curve + (endY - startY) * progress;
    
    // Add some random "shake"
    const shake = Math.random() * 2 - 1;
    movements.push({
      x: Math.round(x + shake),
      y: Math.round(y + shake),
      delay: Math.random() * 5 + baseVelocity // Random delay between movements
    });
  }
  
  return movements;
};

// Function to solve the slider puzzle
const solveCaptchaSlider = async (page: puppeteer.Page): Promise<boolean> => {
  try {
    console.log("🔄 Attempting to solve CAPTCHA slider...");
    
    // Wait for the slider element
    const sliderHandle = await page.waitForSelector('.secsdk-captcha-drag-icon', { timeout: 5000 });
    if (!sliderHandle) {
      console.log("❌ Couldn't find slider handle");
      return false;
    }

    // Get the position and dimensions of the slider
    const sliderBox = await sliderHandle.boundingBox();
    if (!sliderBox) {
      console.log("❌ Couldn't get slider position");
      return false;
    }

    // Calculate start position (middle of slider handle)
    const startX = sliderBox.x + sliderBox.width / 2;
    const startY = sliderBox.y + sliderBox.height / 2;

    // Calculate end position (about 70-90% of the way across)
    const puzzleBox = await page.$('.captcha_verify_container');
    const puzzleBoxDim = await puzzleBox?.boundingBox();
    if (!puzzleBoxDim) {
      console.log("❌ Couldn't get puzzle container dimensions");
      return false;
    }

    // Randomize the end position slightly
    const endX = puzzleBoxDim.x + (puzzleBoxDim.width * (0.7 + Math.random() * 0.2));
    const endY = startY + (Math.random() * 2 - 1); // Slight vertical variation

    // Generate human-like mouse movements
    const movements = generateHumanMouseMovements(startX, startY, endX, endY);

    // Move mouse to start position
    await page.mouse.move(startX, startY);
    await page.mouse.down(); // Press mouse button

    // Execute the movements
    for (const movement of movements) {
      await page.mouse.move(movement.x, movement.y);
      await page.waitForTimeout(movement.delay);
    }

    // Release mouse at final position
    await page.mouse.up();

    // Wait to see if we succeeded
    try {
      await page.waitForFunction(
        () => !document.querySelector('.secsdk-captcha-drag-icon'),
        { timeout: 5000 }
      );
      console.log("✅ CAPTCHA appears to be solved!");
      return true;
    } catch (error) {
      console.log("❌ CAPTCHA solution wasn't accepted");
      return false;
    }
  } catch (error) {
    console.log("❌ Error solving CAPTCHA:", error);
    return false;
  }
};

const scrapeTikTokFollowers = async () => {
  const username = process.env.TIKTOK_USERNAME;
  const password = process.env.TIKTOK_PASSWORD;

  if (!username || !password) {
    throw new Error("Missing TikTok credentials in .env file");
  }

  const browser = await puppeteer.launch({
    headless: false,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    // Set a more realistic user agent
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
    );

    // Navigate to TikTok login
    await page.goto("https://www.tiktok.com/login/phone-or-email/email");
    
    // Wait for login form
    await page.waitForSelector('input[name="username"]', { timeout: 15000 });

    // Auto-login implementation with CAPTCHA handling
    const autoLogin = async () => {
      // Type credentials with random delays to appear more human-like
      await page.type('input[name="username"]', username, { delay: 100 });
      await page.waitForTimeout(1000 + Math.random() * 500);
      await page.type('input[type="password"]', password, { delay: 100 });
      await page.waitForTimeout(500 + Math.random() * 300);
      
      await page.click('button[type="submit"]');
      
      // Wait for either successful navigation or CAPTCHA
      try {
        await Promise.race([
          page.waitForNavigation({ timeout: 10000 }),
          page.waitForSelector('.secsdk-captcha-drag-icon', { timeout: 10000 })
        ]);
        
        // Check if CAPTCHA is present
        const captcha = await page.$('.secsdk-captcha-drag-icon');
        if (captcha) {
          console.log("⚠️ CAPTCHA detected! Attempting automated solution...");
          
          let solved = false;
          // Try solving up to 3 times
          for (let attempt = 1; attempt <= 3 && !solved; attempt++) {
            console.log(`Attempt ${attempt}/3`);
            solved = await solveCaptchaSlider(page);
            if (!solved && attempt < 3) {
              await page.waitForTimeout(1000); // Wait before next attempt
            }
          }
          
          if (!solved) {
            console.log("🔒 Automated solving failed. Please solve manually.");
            await page.waitForNavigation({ timeout: 60000 });
          }
        }
      } catch (error) {
        console.log("Login process completed, checking result...");
      }
    };

    try {
      await autoLogin();
    } catch (error) {
      console.log("Auto-login failed, please login manually");
      await page.waitForNavigation({ timeout: 60000 });
    }

    // Verify login success
    const currentUrl = await page.url();
    if (currentUrl.includes("login")) {
      throw new Error("Login failed. Please check your credentials or try again later.");
    }

    // Go to followers page
    await page.goto(`https://www.tiktok.com/@${username}/followers`);

    // Wait for followers list to load
    await page.waitForSelector('[data-e2e="follower-item"]', {
      timeout: 15000,
    });

    let followers: Follower[] = [];
    let previousHeight = 0;
    let attempts = 0;
    let noNewFollowersCount = 0;

    // Scroll to load all followers
    while (attempts < 20 && noNewFollowersCount < 3) {
      const currentHeight = await page.evaluate(() => document.body.scrollHeight);
      
      if (currentHeight === previousHeight) {
        noNewFollowersCount++;
        await page.waitForTimeout(2000);
        continue;
      }

      noNewFollowersCount = 0;
      previousHeight = currentHeight;
      
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });
      
      await page.waitForTimeout(2000); // Adjust based on network speed

      // Extract follower data
      const newFollowers = await page.$$eval('[data-e2e="follower-item"]', (items) =>
        items.map((item) => ({
          username: item.querySelector("a")?.href?.split("/@")[1] || "",
          profileUrl: item.querySelector("a")?.href || "",
        }))
      );

      // Update followers list and remove duplicates
      followers = Array.from(
        new Map([...followers, ...newFollowers].map((f) => [f.username, f])).values()
      );
      
      console.log(`Found ${followers.length} followers so far...`);
      attempts++;
    }

    // Save results
    fs.writeFileSync("followers.json", JSON.stringify(followers, null, 2));
    console.log(`✅ Saved ${followers.length} followers to followers.json`);

  } finally {
    await browser.close();
  }
};

scrapeTikTokFollowers().catch(console.error);
