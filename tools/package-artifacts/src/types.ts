export interface PackageManifest extends Record<string, unknown> {
  name: string
  version: string
  private?: boolean
  files?: string[]
  main?: string
  types?: string
  bin?: Record<string, string> | string
  exports?: unknown
  imports?: unknown
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  publishConfig?: Record<string, unknown>
}

export interface WorkspacePackage {
  directory: string
  manifest: PackageManifest
}

export interface PackageDiagnostic {
  field: string
  message: string
  packageName: string
}
