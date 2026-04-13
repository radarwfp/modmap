export interface ModuleManifest {
  name: string
  version: string
  description: string
  files: string[]
  exports: Record<string, string>      // symbol -> type signature
  imports: Record<string, string[]>    // moduleName -> [symbols used]
  types?: Record<string, string>       // typeName -> definition
  env?: string[]
  status?: 'draft' | 'stable' | 'deprecated'
  lastModified?: string
}

export interface ProjectMap {
  project: string
  version: string
  description: string
  modules: string[]
  graph: Record<string, { dependsOn: string[] }>
  entrypoints?: Record<string, string>
  conventions?: Record<string, string>
  lastModified?: string
}

export interface MeasureResult {
  task: string
  modulesInvolved: string[]
  oldWay: {
    totalTokens: number
    breakdown: Record<string, number>
  }
  modularWay: {
    totalTokens: number
    breakdown: {
      projectMap: number
      activeModuleCode: number
      allManifests: number
    }
  }
  savings: {
    tokens: number
    percentage: number
  }
}

export interface SessionOutput {
  task: string
  modulesInvolved: string[]
  prompt: string
  estimatedTokens: number
}
