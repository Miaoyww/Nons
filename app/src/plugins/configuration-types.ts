export interface ConfigSnapshot {
  values: Record<string, unknown>
  revision: number
  diagnostics: Record<string, string>
  pendingReload: boolean
}
export interface ConfigField {
  key: string
  title: string
  description: string
  schema: Record<string, unknown>
  default: unknown
  apply: 'live' | 'reload'
  group?: string | null
  editor?: {
    kind:
      | 'text'
      | 'textarea'
      | 'number'
      | 'switch'
      | 'slider'
      | 'select'
      | 'multiselect'
      | 'color'
      | 'file'
      | 'directory'
    min?: number | null
    max?: number | null
    step?: number | null
    unit?: string | null
    options: { label: string; value: unknown }[]
  } | null
}
export interface ConfigDefinition {
  version: 1
  page: { mode: 'generated' } | { mode: 'custom'; pageId: string }
  fields: ConfigField[]
}
export interface DirectoryGrant {
  id: string
  path: string
  writable: boolean
}
export interface PluginSettings {
  definition: ConfigDefinition | null
  snapshot: ConfigSnapshot | null
  grants: DirectoryGrant[]
}
