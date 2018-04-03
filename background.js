// Param values from https://developer.mozilla.org/Add-ons/WebExtensions/API/contextualIdentities/create
const TWITTER_CONTAINER_NAME = "Twitter";
const TWITTER_CONTAINER_COLOR = "blue";
const TWITTER_CONTAINER_ICON = "briefcase";
const TWITTER_DOMAINS = ["twitter.com", "www.twitter.com", "t.co", "twimg.com"];

const MAC_ADDON_ID = "@testpilot-containers";

let twitterCookieStoreId = null;

const twitterHostREs = [];

async function isTwitterAlreadyAssignedInMAC () {
  let macAddonInfo;
  // If the MAC add-on isn't installed, return false
  try {
    macAddonInfo = await browser.management.get(MAC_ADDON_ID);
  } catch (e) {
    return false;
  }
  let anyTwitterDomainsAssigned = false;
  for (let twitterDomain of TWITTER_DOMAINS) {
    const twitterCookieUrl = `https://${twitterDomain}/`;
    const assignment = await browser.runtime.sendMessage(MAC_ADDON_ID, {
      method: "getAssignment",
      url: twitterCookieUrl
    });
    if (assignment) {
      anyTwitterDomainsAssigned = true;
    }
  }
  return anyTwitterDomainsAssigned;
}

(async function init() {
  const twitterAlreadyAssigned = await isTwitterAlreadyAssignedInMAC();
  if (twitterAlreadyAssigned) {
    return;
  }

  // Clear all twitter cookies
  for (let twitterDomain of TWITTER_DOMAINS) {
    twitterHostREs.push(new RegExp(`^(.*\\.)?${twitterDomain}$`)); 
    const twitterCookieUrl = `https://${twitterDomain}/`;

    browser.cookies.getAll({domain: twitterDomain}).then(cookies => {
      for (let cookie of cookies) {
        browser.cookies.remove({name: cookie.name, url: twitterCookieUrl});
      }
    });
  }

  // Use existing Twitter container, or create one
  browser.contextualIdentities.query({name: TWITTER_CONTAINER_NAME}).then(contexts => {
    if (contexts.length > 0) {
      twitterCookieStoreId = contexts[0].cookieStoreId;
    } else {
      browser.contextualIdentities.create({
        name: TWITTER_CONTAINER_NAME,
        color: TWITTER_CONTAINER_COLOR,
        icon: TWITTER_CONTAINER_ICON}
      ).then(context => {
        twitterCookieStoreId = context.cookieStoreId;
      });
    }
  });

  // Listen to requests and open Twitter into its Container,
  // open other sites into the default tab context
  async function containTwitter(options) {
    const requestUrl = new URL(options.url);
    let isTwitter = false;
    for (let twitterHostRE of twitterHostREs) {
      if (twitterHostRE.test(requestUrl.host)) {
        isTwitter = true;
        break;
      }
    }
    const tab = await browser.tabs.get(options.tabId);
    const tabCookieStoreId = tab.cookieStoreId;
    if (isTwitter) {
      if (tabCookieStoreId !== twitterCookieStoreId && !tab.incognito) {
        // See https://github.com/mozilla/contain-twitter/issues/23
        // Sometimes this add-on is installed but doesn't get a twitterCookieStoreId ?
        if (twitterCookieStoreId) {
          browser.tabs.create({url: requestUrl.toString(), cookieStoreId: twitterCookieStoreId});
          browser.tabs.remove(options.tabId);
          return {cancel: true};
        }
      }
    } else {
      if (tabCookieStoreId === twitterCookieStoreId) {
        browser.tabs.create({url: requestUrl.toString()});
        browser.tabs.remove(options.tabId);
        return {cancel: true};
      }
    }
  }

  // Add the request listener
  browser.webRequest.onBeforeRequest.addListener(containTwitter, {urls: ["<all_urls>"], types: ["main_frame"]}, ["blocking"]);
})();
