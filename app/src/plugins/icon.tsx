import { FolderOpen, Pause, Play, Search, Settings, Trash2 } from 'lucide-react'
const icons = {
  folder: FolderOpen,
  pause: Pause,
  play: Play,
  search: Search,
  settings: Settings,
  delete: Trash2
}
export function Icon({ name }: { name: keyof typeof icons }) {
  const Component = icons[name]
  return <Component aria-hidden="true" />
}
