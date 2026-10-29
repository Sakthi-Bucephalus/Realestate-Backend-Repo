/**
 * Meta (Facebook / Instagram) Lead Ads Graph API Service
 * EstateFlow CRM - Official Graph API Integration
 */

const getGraphApiVersion = () => process.env.META_GRAPH_API_VERSION || 'v21.0';
const getGraphApiBase = () => `https://graph.facebook.com/${getGraphApiVersion()}`;

/**
 * Helper to resolve the configured Meta Webhook URL
 * Used by Meta for subscription verification & leadgen event delivery
 */
const getWebhookUrl = () => {
  if (process.env.META_WEBHOOK_URL) return process.env.META_WEBHOOK_URL;
  if (process.env.FB_WEBHOOK_URL) return process.env.FB_WEBHOOK_URL;
  if (process.env.FACEBOOK_WEBHOOK_URL) return process.env.FACEBOOK_WEBHOOK_URL;

  const publicBase = process.env.BACKEND_PUBLIC_URL || `http://localhost:${process.env.PORT || 5000}`;
  return `${publicBase.replace(/\/+$/, '')}/api/meta/webhook`;
};

/**
 * Helper to resolve the configured Facebook OAuth Redirect URI
 * Used by Facebook Login dialog to redirect back after user authorization
 */
const getRedirectUri = (customRedirectUri = null) => {
  if (customRedirectUri) return customRedirectUri;
  if (process.env.META_REDIRECT_URI) return process.env.META_REDIRECT_URI;
  if (process.env.FB_REDIRECT_URI) return process.env.FB_REDIRECT_URI;
  if (process.env.FACEBOOK_REDIRECT_URI) return process.env.FACEBOOK_REDIRECT_URI;
  if (process.env.META_REDIRECT_URL) return process.env.META_REDIRECT_URL;
  if (process.env.FACEBOOK_REDIRECT_URL) return process.env.FACEBOOK_REDIRECT_URL;

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  return `${frontendUrl.replace(/\/+$/, '')}/connect-meta/callback`;
};

/**
 * Helper to get configured OAuth Scopes for Facebook Lead Ads
 * By default requests official lead ads permissions without 'email'
 * (Meta Business / Lead Ads apps reject personal 'email' scope in v21.0)
 */
const getOAuthScopes = () => {
  if (process.env.META_SCOPES) {
    return process.env.META_SCOPES.split(',').map((s) => s.trim()).filter(Boolean).join(',');
  }
  return [
    'public_profile',
    'pages_show_list',
    'pages_read_engagement',
    'pages_manage_metadata',
    'leads_retrieval',
    'pages_manage_ads',
  ].join(',');
};

/**
 * Generate official Facebook OAuth Dialog URL
 */
const getOAuthUrl = (state, customRedirectUri = null) => {
  const appId = process.env.META_APP_ID;
  const redirectUri = getRedirectUri(customRedirectUri);
  const version = getGraphApiVersion();
  const scopes = getOAuthScopes();

  const params = new URLSearchParams({
    client_id: appId || '',
    redirect_uri: redirectUri,
    state,
    scope: scopes,
    response_type: 'code',
  });

  return `https://www.facebook.com/${version}/dialog/oauth?${params.toString()}`;
};

/**
 * Exchange OAuth authorization code for User Access Token (short-lived then long-lived)
 */
const exchangeCodeForTokens = async (code, customRedirectUri = null) => {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const redirectUri = getRedirectUri(customRedirectUri);
  const version = getGraphApiVersion();

  if (!appId || !appSecret) {
    throw new Error('Meta App ID and App Secret must be configured in environment variables.');
  }

  // 1. Exchange authorization code for short-lived access token
  const tokenUrl = `https://graph.facebook.com/${version}/oauth/access_token?` +
    new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      redirect_uri: redirectUri,
      code,
    }).toString();

  let tokenRes = await fetch(tokenUrl);
  let tokenData = await tokenRes.json();

  // If redirect_uri mismatch occurred (error_subcode 36008), retry with candidate alternatives
  if (tokenData.error?.error_subcode === 36008) {
    const candidates = [
      process.env.META_REDIRECT_URI,
      `${(process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '')}/connect-meta/callback`,
      customRedirectUri,
    ].filter((u) => u && u !== redirectUri);

    for (const altUri of candidates) {
      console.warn(`[MetaService] Retrying token exchange with alternative redirect_uri: "${altUri}"`);
      const retryUrl = `https://graph.facebook.com/${version}/oauth/access_token?` +
        new URLSearchParams({
          client_id: appId,
          client_secret: appSecret,
          redirect_uri: altUri,
          code,
        }).toString();

      const retryRes = await fetch(retryUrl);
      const retryData = await retryRes.json();
      if (retryRes.ok && retryData.access_token) {
        tokenRes = retryRes;
        tokenData = retryData;
        console.log(`[MetaService] Retry succeeded with redirect_uri: "${altUri}"`);
        break;
      }
    }
  }

  if (!tokenRes.ok || tokenData.error) {
    const errorMsg = tokenData.error?.message || 'Failed to exchange authorization code for Meta access token';
    console.error('[MetaService] Token exchange error:', tokenData.error);
    throw new Error(errorMsg);
  }

  const shortLivedToken = tokenData.access_token;

  // 2. Exchange short-lived token for long-lived user token (~60 days lifespan)
  const exchangeUrl = `https://graph.facebook.com/${version}/oauth/access_token?` +
    new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: shortLivedToken,
    }).toString();

  const exchangeRes = await fetch(exchangeUrl);
  const exchangeData = await exchangeRes.json();

  let finalAccessToken = shortLivedToken;
  let expiresIn = tokenData.expires_in || 5184000; // default 60 days

  if (exchangeRes.ok && exchangeData.access_token) {
    finalAccessToken = exchangeData.access_token;
    expiresIn = exchangeData.expires_in || expiresIn;
  }

  const expiresAt = new Date(Date.now() + expiresIn * 1000);

  // 3. Fetch user profile
  const userProfile = await getUserProfile(finalAccessToken);

  return {
    accessToken: finalAccessToken,
    expiresAt,
    expiresIn,
    userProfile,
  };
};

/**
 * Fetch Facebook User Profile details
 */
const getUserProfile = async (userAccessToken) => {
  const version = getGraphApiVersion();
  const res = await fetch(`https://graph.facebook.com/${version}/me?fields=id,name&access_token=${userAccessToken}`);
  const data = await res.json();

  if (!res.ok || data.error) {
    throw new Error(data.error?.message || 'Failed to retrieve Facebook user profile');
  }

  return data;
};

/**
 * Fetch Facebook Pages that the authorized user manages
 */
const getUserPages = async (userAccessToken) => {
  const version = getGraphApiVersion();
  const url = `https://graph.facebook.com/${version}/me/accounts?fields=id,name,category,tasks,access_token&limit=100&access_token=${userAccessToken}`;

  const res = await fetch(url);
  const data = await res.json();

  if (!res.ok || data.error) {
    console.error('[MetaService] getUserPages error:', data.error);
    throw new Error(data.error?.message || 'Failed to retrieve Facebook Pages from Meta API');
  }

  return (data.data || []).map((page) => ({
    pageId: page.id,
    pageName: page.name,
    pageCategory: page.category || 'Business Page',
    pageAccessToken: page.access_token,
    tasks: page.tasks || [],
  }));
};

/**
 * Fetch Lead Ads Forms for a specific Facebook Page
 */
const getPageLeadForms = async (pageId, pageAccessToken) => {
  const version = getGraphApiVersion();
  const url = `https://graph.facebook.com/${version}/${pageId}/leadgen_forms?fields=id,name,status,leads_count,created_time,locale&limit=100&access_token=${pageAccessToken}`;

  const res = await fetch(url);
  const data = await res.json();

  if (!res.ok || data.error) {
    console.error(`[MetaService] getPageLeadForms for page ${pageId} error:`, data.error);
    throw new Error(data.error?.message || 'Failed to retrieve lead forms from Facebook Page');
  }

  return (data.data || []).map((form) => ({
    formId: form.id,
    formName: form.name,
    status: form.status || 'ACTIVE',
    leadsCount: form.leads_count || 0,
    createdTime: form.created_time,
  }));
};

/**
 * Subscribe Meta Lead Ads webhook to a specific Facebook Page
 */
const subscribePageWebhook = async (pageId, pageAccessToken) => {
  const version = getGraphApiVersion();
  const url = `https://graph.facebook.com/${version}/${pageId}/subscribed_apps`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      subscribed_fields: 'leadgen',
      access_token: pageAccessToken,
    }).toString(),
  });

  const data = await res.json();

  if (!res.ok || data.error) {
    console.error(`[MetaService] subscribePageWebhook for page ${pageId} failed:`, data.error);
    throw new Error(data.error?.message || 'Failed to subscribe Page to Meta Leadgen Webhook');
  }

  return data;
};

/**
 * Unsubscribe webhook from a Facebook Page
 */
const unsubscribePageWebhook = async (pageId, pageAccessToken) => {
  const version = getGraphApiVersion();
  const url = `https://graph.facebook.com/${version}/${pageId}/subscribed_apps?access_token=${pageAccessToken}`;

  const res = await fetch(url, {
    method: 'DELETE',
  });

  const data = await res.json();
  return data;
};

/**
 * Fetch single lead details from Meta Graph API using leadgen_id
 */
const getLeadDetails = async (leadgenId, pageAccessToken) => {
  const version = getGraphApiVersion();
  const fields = [
    'id',
    'created_time',
    'ad_id',
    'ad_name',
    'adset_id',
    'adset_name',
    'campaign_id',
    'campaign_name',
    'form_id',
    'is_organic',
    'platform',
    'field_data',
  ].join(',');

  const url = `https://graph.facebook.com/${version}/${leadgenId}?fields=${fields}&access_token=${pageAccessToken}`;

  const res = await fetch(url);
  const data = await res.json();

  if (!res.ok || data.error) {
    console.error(`[MetaService] getLeadDetails for lead ${leadgenId} failed:`, data.error);
    throw new Error(data.error?.message || `Failed to fetch lead ${leadgenId} from Meta`);
  }

  return data;
};

/**
 * Fetch batch of past/existing leads from a Lead Form (for initial sync or recovery)
 */
const getFormLeads = async (formId, pageAccessToken, limit = 50) => {
  const version = getGraphApiVersion();
  const fields = [
    'id',
    'created_time',
    'ad_id',
    'ad_name',
    'adset_id',
    'adset_name',
    'campaign_id',
    'campaign_name',
    'form_id',
    'platform',
    'field_data',
  ].join(',');

  const url = `https://graph.facebook.com/${version}/${formId}/leads?fields=${fields}&limit=${limit}&access_token=${pageAccessToken}`;

  const res = await fetch(url);
  const data = await res.json();

  if (!res.ok || data.error) {
    console.error(`[MetaService] getFormLeads for form ${formId} failed:`, data.error);
    throw new Error(data.error?.message || 'Failed to fetch form leads from Meta');
  }

  return data.data || [];
};

/**
 * Parse and normalize Meta raw lead payload into EstateFlow Lead schema fields
 */
const parseLeadData = (rawLead) => {
  const fieldData = rawLead.field_data || [];
  const formAnswers = [];

  let name = '';
  let firstName = '';
  let lastName = '';
  let phone = '';
  let email = '';
  let preferredLocation = '';
  let budget = 0;
  let preferredPropertyType = 'Residential Plot';

  fieldData.forEach((item) => {
    const key = (item.name || '').toLowerCase();
    const val = Array.isArray(item.values) ? item.values[0] || '' : String(item.values || '');

    // Record question answer
    formAnswers.push({
      fieldName: item.name,
      label: item.name ? item.name.replace(/_/g, ' ') : 'Question',
      value: val,
    });

    // Detect full name or first/last
    if (key === 'full_name' || key === 'fullname' || key === 'name') {
      name = val.trim();
    } else if (key === 'first_name' || key === 'firstname') {
      firstName = val.trim();
    } else if (key === 'last_name' || key === 'lastname') {
      lastName = val.trim();
    }

    // Detect phone number
    if (
      key === 'phone_number' ||
      key === 'phone' ||
      key === 'mobile_number' ||
      key === 'contact_number' ||
      key.includes('phone')
    ) {
      phone = val.trim();
    }

    // Detect email
    if (key === 'email' || key === 'email_address' || key.includes('email')) {
      email = val.trim().toLowerCase();
    }

    // Detect location preferences
    if (key.includes('location') || key.includes('city') || key.includes('area')) {
      preferredLocation = val.trim();
    }

    // Detect property type
    if (key.includes('property') || key.includes('unit_type') || key.includes('type')) {
      const lowerVal = val.toLowerCase();
      if (lowerVal.includes('villa') || lowerVal.includes('house')) {
        preferredPropertyType = 'Villa / House';
      } else if (lowerVal.includes('apartment') || lowerVal.includes('flat')) {
        preferredPropertyType = 'Apartment';
      } else if (lowerVal.includes('commercial')) {
        preferredPropertyType = 'Commercial';
      } else if (lowerVal.includes('land') || lowerVal.includes('farm')) {
        preferredPropertyType = 'Agricultural Land';
      }
    }

    // Detect budget
    if (key.includes('budget') || key.includes('price') || key.includes('investment')) {
      const numericVal = parseFloat(val.replace(/[^0-9.]/g, ''));
      if (!isNaN(numericVal) && numericVal > 0) {
        budget = numericVal;
      }
    }
  });

  // Assemble full name if split
  if (!name && (firstName || lastName)) {
    name = `${firstName} ${lastName}`.trim();
  }
  if (!name) {
    name = `Meta Lead #${rawLead.id ? rawLead.id.slice(-6) : Math.floor(1000 + Math.random() * 9000)}`;
  }

  // Fallback phone if missing from custom form
  if (!phone) {
    phone = 'N/A';
  }

  return {
    metaLeadId: rawLead.id,
    name,
    phone,
    email,
    preferredLocation,
    preferredPropertyType,
    budgetMin: budget > 0 ? Math.round(budget * 0.8) : 0,
    budgetMax: budget > 0 ? budget : 0,
    metaCampaignId: rawLead.campaign_id || '',
    metaCampaignName: rawLead.campaign_name || '',
    metaAdSetId: rawLead.adset_id || '',
    metaAdSetName: rawLead.adset_name || '',
    metaAdId: rawLead.ad_id || '',
    metaAdName: rawLead.ad_name || '',
    metaFormId: rawLead.form_id || '',
    metaPlatform: rawLead.platform || 'fb',
    metaCreatedAt: rawLead.created_time ? new Date(rawLead.created_time) : new Date(),
    formAnswers,
    metaRawData: rawLead,
  };
};

/**
 * Health check on current Meta User Token against Graph API
 */
const checkTokenHealth = async (userAccessToken) => {
  const version = getGraphApiVersion();
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;

  try {
    // If App credentials exist, use debug_token endpoint
    if (appId && appSecret) {
      const appToken = `${appId}|${appSecret}`;
      const url = `https://graph.facebook.com/${version}/debug_token?input_token=${userAccessToken}&access_token=${appToken}`;
      const res = await fetch(url);
      const data = await res.json();

      if (res.ok && data.data) {
        const info = data.data;
        const isValid = info.is_valid === true;
        const expiresAt = info.expires_at ? new Date(info.expires_at * 1000) : null;
        return {
          isValid,
          scopes: info.scopes || [],
          expiresAt,
          userId: info.user_id,
          appId: info.app_id,
          message: isValid ? 'Token is healthy and valid' : 'Token has expired or was revoked',
        };
      }
    }

    // Fallback simple /me check
    const meRes = await fetch(`https://graph.facebook.com/${version}/me?access_token=${userAccessToken}`);
    const meData = await meRes.json();

    if (meRes.ok && meData.id) {
      return {
        isValid: true,
        userId: meData.id,
        message: 'Token verified successfully via /me',
      };
    }

    return {
      isValid: false,
      message: meData.error?.message || 'Token verification failed',
    };
  } catch (err) {
    return {
      isValid: false,
      message: err.message,
    };
  }
};

module.exports = {
  getGraphApiVersion,
  getOAuthUrl,
  getOAuthScopes,
  exchangeCodeForTokens,
  getUserProfile,
  getUserPages,
  getPageLeadForms,
  subscribePageWebhook,
  unsubscribePageWebhook,
  getLeadDetails,
  getFormLeads,
  parseLeadData,
  checkTokenHealth,
  getWebhookUrl,
  getRedirectUri,
};
