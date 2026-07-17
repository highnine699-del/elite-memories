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
    // Validate session token
    const authHeader = req.headers.get('Authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const token = authHeader.substring(7)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Check if session is valid
    const { data: session, error: sessionError } = await supabase
      .from('admin_sessions')
      .select('*')
      .eq('token', token)
      .gt('expires_at', new Date().toISOString())
      .single()

    if (sessionError || !session) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired session' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get photoId from request
    const { photoId } = await req.json()
    
    if (!photoId) {
      return new Response(
        JSON.stringify({ error: 'photoId required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Look up photo to get storage path
    const { data: photo, error: photoError } = await supabase
      .from('photos')
      .select('storage_path')
      .eq('id', photoId)
      .single()

    if (photoError || !photo) {
      return new Response(
        JSON.stringify({ error: 'Photo not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Delete from storage
    const { error: storageError } = await supabase
      .storage
      .from('elite-memories')
      .remove([photo.storage_path])

    if (storageError) {
      console.error('Error deleting from storage:', storageError)
      return new Response(
        JSON.stringify({ error: 'Failed to delete file from storage' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Delete from database
    const { error: dbError } = await supabase
      .from('photos')
      .delete()
      .eq('id', photoId)

    if (dbError) {
      console.error('Error deleting from database:', dbError)
      return new Response(
        JSON.stringify({ error: 'Failed to delete photo record' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error in admin-delete:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
