// buyzaar-webhook-worker.js
// Deploy this to Cloudflare Workers

// CORS headers for Flutter web
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Store last update timestamp (in-memory, resets on worker restart)
let lastUpdateTimestamp = null;
let pendingRefresh = false;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }
    
    // 🔔 WEBHOOK ENDPOINT (GitHub calls this)
    if (url.pathname === '/webhook' && request.method === 'POST') {
      try {
        const payload = await request.json();
        const event = request.headers.get('X-GitHub-Event');
        
        // Only care about push events to main branch
        if (event === 'push') {
          const branch = payload.ref;
          if (branch === 'refs/heads/main') {
            // Check if products.json or settings.json changed
            const commits = payload.commits || [];
            let productsChanged = false;
            
            for (const commit of commits) {
              const files = [...(commit.added || []), ...(commit.modified || [])];
              if (files.includes('products.json') || files.includes('settings.json')) {
                productsChanged = true;
                break;
              }
            }
            
            if (productsChanged) {
              lastUpdateTimestamp = Date.now();
              pendingRefresh = true;
              console.log(`✅ Webhook received! Products updated at ${new Date().toISOString()}`);
              
              // Store in KV for persistence (optional - if you have KV namespace)
              if (env.BUYZAAR_KV) {
                await env.BUYZAAR_KV.put('last_update', String(lastUpdateTimestamp));
              }
            }
          }
        }
        
        return new Response(JSON.stringify({ status: 'ok' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (e) {
        console.error('Webhook error:', e);
        return new Response(JSON.stringify({ error: e.message }), { status: 500 });
      }
    }
    
    // 📡 STATUS ENDPOINT (Flutter app calls this)
    if (url.pathname === '/status' && request.method === 'GET') {
      let timestamp = lastUpdateTimestamp;
      
      // Check KV if available
      if (env.BUYZAAR_KV && !timestamp) {
        const stored = await env.BUYZAAR_KV.get('last_update');
        if (stored) timestamp = parseInt(stored);
      }
      
      // Reset pending refresh after it's been read
      const needsRefresh = pendingRefresh;
      if (pendingRefresh) {
        pendingRefresh = false;
      }
      
      return new Response(JSON.stringify({
        lastUpdate: timestamp,
        needsRefresh: needsRefresh,
        time: Date.now(),
      }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
    
    // 🏠 Home endpoint
    return new Response('Buyzaar Webhook Worker Active', {
      headers: corsHeaders
    });
  }
};
