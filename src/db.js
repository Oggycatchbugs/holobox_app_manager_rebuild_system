const { createClient } = require('@supabase/supabase-js');
const config = require('./config');

let client = null;

function getSupabase() {
  if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  }
  if (!client) {
    client = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

async function one(query, message = 'Database query failed') {
  const { data, error } = await query;
  if (error) throw new Error(`${message}: ${error.message}`);
  return data;
}

async function maybeOne(query, message = 'Database query failed') {
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`${message}: ${error.message}`);
  return data;
}

module.exports = { getSupabase, one, maybeOne };
