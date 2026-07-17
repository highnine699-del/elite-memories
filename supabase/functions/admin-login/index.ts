import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { password } = await req.json()
    
    if (!password) {
      return new Response(
        JSON.stringify({ error: 'Password required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get admin password from environment
    const adminPassword = Deno.env.get('ADMIN_PASSWORD')
    
    if (!adminPassword) {
      return new Response(
        JSON.stringify({ error: 'Server configuration error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (password !== adminPassword) {
      return new Response(
        JSON.stringify({ error: 'Invalid password' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Rate limiting check
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const ip = req.headers.get('CF-Connecting-IP') || 'unknown'
    const ipHash = await hashIP(ip)
    
    // Check rate limit (10 attempts per hour)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    
    const { data: rateLimit } = await supabase
      .from('rate_limits')
      .select('*')
      .eq('ip_hash', ipHash)
      .single()

    if (rateLimit) {
      if (rateLimit.window_start > oneHourAgo && rateLimit.request_count >= 10) {
        return new Response(
          JSON.stringify({ error: 'Too many login attempts' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      
      // Reset if window expired
      if (rateLimit.window_start <= oneHourAgo) {
        await supabase
          .from('rate_limits')
          .update({ request_count: 1, window_start: new Date().toISOString() })
          .eq('ip_hash', ipHash)
      } else {
        await supabase
          .from('rate_limits')
          .update({ request_count: rateLimit.request_count + 1 })
          .eq('ip_hash', ipHash)
      }
    } else {
      await supabase
        .from('rate_limits')
        .insert({ ip_hash: ipHash, request_count: 1, window_start: new Date().toISOString() })
    }

    // Generate session token
    const token = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

    await supabase
      .from('admin_sessions')
      .insert({ token, expires_at: expiresAt })

    return new Response(
      JSON.stringify({ token }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error in admin-login:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function hashIP(ip: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(ip)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}
