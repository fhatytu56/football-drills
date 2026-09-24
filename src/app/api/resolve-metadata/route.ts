import { NextRequest, NextResponse } from 'next/server'

function detectPlatform(url: string): 'youtube' | 'vimeo' | 'instagram' | 'tiktok' | 'other' {
  if (/youtube\.com|youtu\.be/.test(url)) return 'youtube'
  if (/vimeo\.com/.test(url)) return 'vimeo'
  if (/instagram\.com/.test(url)) return 'instagram'
  if (/tiktok\.com/.test(url)) return 'tiktok'
  return 'other'
}

export async function POST(req: NextRequest) {
  const { url } = await req.json()
  if (!url) return NextResponse.json({ error: 'URL required' }, { status: 400 })

  const platform = detectPlatform(url)
  let oembedUrl: string | null = null

  switch (platform) {
    case 'youtube':
      oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`
      break
    case 'vimeo':
      oembedUrl = `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`
      break
    // instagram/tiktok oEmbed require app tokens — skip auto-fetch, user fills manually
  }

  if (!oembedUrl) {
    return NextResponse.json({ platform, title: '', thumbnail_url: null })
  }

  try {
    const res = await fetch(oembedUrl)
    if (!res.ok) throw new Error('oEmbed fetch failed')
    const data = await res.json()

    return NextResponse.json({
      platform,
      title: data.title ?? '',
      thumbnail_url: data.thumbnail_url ?? null,
    })
  } catch {
    return NextResponse.json({ platform, title: '', thumbnail_url: null })
  }
}
