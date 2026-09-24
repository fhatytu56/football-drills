import { ExternalLink } from 'lucide-react'
import type { PlatformType } from '@/types/database.types'

function getYouTubeEmbedUrl(url: string): string | null {
  const match = url.match(
    /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{6,})/
  )
  return match ? `https://www.youtube.com/embed/${match[1]}` : null
}

function getVimeoEmbedUrl(url: string): string | null {
  const match = url.match(/vimeo\.com\/(?:.*\/)?(\d+)/)
  return match ? `https://player.vimeo.com/video/${match[1]}` : null
}

export default function VideoEmbed({
  url,
  platform,
  title,
}: {
  url: string
  platform: PlatformType
  title: string
}) {
  let embedUrl: string | null = null
  if (platform === 'youtube') embedUrl = getYouTubeEmbedUrl(url)
  if (platform === 'vimeo') embedUrl = getVimeoEmbedUrl(url)

  if (embedUrl) {
    return (
      <div className="relative aspect-video bg-black rounded-b-2xl overflow-hidden">
        <iframe
          src={embedUrl}
          title={title}
          className="absolute inset-0 w-full h-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    )
  }

  // Instagram/TikTok/other: no reliable inline embed without app tokens — fall back to external link
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="relative aspect-video bg-club-900 rounded-b-2xl flex flex-col items-center justify-center gap-2 text-white"
    >
      <ExternalLink size={28} />
      <span className="text-sm font-medium">Open on {platform}</span>
    </a>
  )
}
