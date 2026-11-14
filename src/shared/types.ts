export type WindowAction = 'minimize' | 'maximize' | 'close'

export interface AppInfo {
  version: string
}

export interface IdeApi {
  app: {
    getInfo(): Promise<AppInfo>
    windowAction(action: WindowAction): Promise<void>
  }
}
