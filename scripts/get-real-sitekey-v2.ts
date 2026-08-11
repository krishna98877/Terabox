/**
 * Get sitekey by clicking Login -> Sign Up in TeraBox
 */
async function main() {
  const puppeteer = await import('puppeteer');
  const browser = await puppeteer.default.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
  });
  
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  
  // Intercept network requests
  const recaptchaRequests: string[] = [];
  page.on('request', req => {
    const url = req.url();
    if (url.includes('recaptcha')) {
      recaptchaRequests.push(url);
    }
  });

  console.log('Loading TeraBox...');
  await page.goto('https://www.1024terabox.com/', { waitUntil: 'networkidle2', timeout: 30000 });
  
  // Click "Login" button
  console.log('Clicking Login...');
  await page.evaluate(() => {
    const loginBtn = document.querySelector('.login-btn');
    if (loginBtn) (loginBtn as HTMLElement).click();
  });
  await new Promise(r => setTimeout(r, 3000));
  
  // Take screenshot
  await page.screenshot({ path: '/home/z/my-project/download/tb-login.png' });
  console.log('Login screenshot saved');
  
  // Check what's visible now
  const afterLogin = await page.evaluate(() => {
    const elements = document.querySelectorAll('a, button, div[class*="tab"], div[class*="sign"], div[class*="register"], span, input');
    const relevant = Array.from(elements).filter(el => {
      const text = (el.textContent || '').trim().toLowerCase();
      const cls = (el.className || '').toString().toLowerCase();
      return text.includes('sign up') || text.includes('register') || text.includes('email') ||
             cls.includes('sign') || cls.includes('register') || cls.includes('email') ||
             cls.includes('tab') || cls.includes('toggle');
    }).slice(0, 20);
    
    return relevant.map(el => ({
      tag: el.tagName,
      text: (el.textContent || '').trim().substring(0, 60),
      cls: (el.className || '').toString().substring(0, 80),
      type: (el as HTMLInputElement).type || '',
    }));
  });
  
  console.log('\nRelevant elements after login click:');
  for (const el of afterLogin) {
    console.log(`  ${el.tag} text="${el.text}" cls="${el.cls}" type="${el.type}"`);
  }
  
  // Try to click "Sign Up" tab/button
  console.log('\nLooking for Sign Up...');
  const clicked = await page.evaluate(() => {
    const elements = document.querySelectorAll('span, div, a, button');
    for (const el of elements) {
      const text = (el.textContent || '').trim().toLowerCase();
      const cls = (el.className || '').toString().toLowerCase();
      if ((text === 'sign up' || text === 'register') || 
          (cls.includes('sign-up') || cls.includes('register'))) {
        (el as HTMLElement).click();
        return el.textContent?.trim();
      }
    }
    return null;
  });
  
  if (clicked) {
    console.log(`Clicked: "${clicked}"`);
    await new Promise(r => setTimeout(r, 3000));
  } else {
    console.log('No Sign Up button found');
    
    // Try alternative: look for email tab/input
    const emailTab = await page.evaluate(() => {
      const elements = document.querySelectorAll('span, div, a, button');
      for (const el of elements) {
        const text = (el.textContent || '').trim().toLowerCase();
        const cls = (el.className || '').toString().toLowerCase();
        if (text.includes('email') || cls.includes('email')) {
          (el as HTMLElement).click();
          return el.textContent?.trim();
        }
      }
      return null;
    });
    console.log(`Email tab clicked: ${emailTab}`);
    await new Promise(r => setTimeout(r, 3000));
  }
  
  await page.screenshot({ path: '/home/z/my-project/download/tb-signup.png' });
  console.log('Signup screenshot saved');
  
  // Check for reCAPTCHA
  const rcInfo = await page.evaluate(() => {
    const iframes = document.querySelectorAll('iframe');
    const rcIframes = Array.from(iframes).filter(f => f.src.includes('recaptcha'));
    const widgets = document.querySelectorAll('[data-sitekey]');
    return {
      allIframes: Array.from(iframes).map(f => ({ src: f.src.substring(0, 100), id: f.id })),
      rcIframes: rcIframes.map(f => f.src),
      sitekeys: Array.from(widgets).map(w => w.getAttribute('data-sitekey')),
      hasGrecaptcha: typeof (window as any).grecaptcha !== 'undefined',
    };
  });
  
  console.log('\nreCAPTCHA check:', JSON.stringify(rcInfo, null, 2));
  
  // Check network requests
  console.log(`\nRecaptcha network requests: ${recaptchaRequests.length}`);
  for (const r of recaptchaRequests) {
    console.log(`  ${r.substring(0, 200)}`);
    const kMatch = r.match(/[?&]k=([^&]+)/);
    if (kMatch) {
      console.log(`  ★★★ SITEKEY: ${kMatch[1]} ★★★`);
    }
  }
  
  // Try one more thing: type an email and click submit to trigger captcha
  console.log('\nTrying to trigger captcha by submitting email...');
  try {
    // Find email input
    const emailInput = await page.$('input[type="email"], input[name*="email"], input[placeholder*="email"]');
    if (emailInput) {
      await emailInput.type('testcaptcha123@catchmail.io');
      console.log('Typed email');
      
      // Find and click submit/next button
      await page.evaluate(() => {
        const btns = document.querySelectorAll('button, div[class*="btn"], a[class*="btn"]');
        for (const btn of btns) {
          const text = (btn.textContent || '').trim().toLowerCase();
          if (text.includes('next') || text.includes('submit') || text.includes('continue') || text.includes('send')) {
            (btn as HTMLElement).click();
            return;
          }
        }
      });
      
      await new Promise(r => setTimeout(r, 5000));
      await page.screenshot({ path: '/home/z/my-project/download/tb-after-submit.png' });
      console.log('After-submit screenshot saved');
      
      // Check for reCAPTCHA again
      const rcInfo2 = await page.evaluate(() => {
        const iframes = document.querySelectorAll('iframe');
        const rcIframes = Array.from(iframes).filter(f => f.src.includes('recaptcha'));
        const widgets = document.querySelectorAll('[data-sitekey]');
        return {
          rcIframes: rcIframes.map(f => f.src),
          sitekeys: Array.from(widgets).map(w => w.getAttribute('data-sitekey')),
          hasGrecaptcha: typeof (window as any).grecaptcha !== 'undefined',
        };
      });
      console.log('\nreCAPTCHA after submit:', JSON.stringify(rcInfo2, null, 2));
    } else {
      console.log('No email input found');
    }
  } catch (e: any) {
    console.log(`Error: ${e.message}`);
  }
  
  // Final check of network requests
  console.log(`\nAll recaptcha requests: ${recaptchaRequests.length}`);
  for (const r of recaptchaRequests) {
    const kMatch = r.match(/[?&]k=([^&]+)/);
    console.log(`  ${r.substring(0, 200)}${kMatch ? ` → SITEKEY: ${kMatch[1]}` : ''}`);
  }
  
  await browser.close();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
