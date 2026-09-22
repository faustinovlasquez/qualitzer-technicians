export interface ApiEnvironment {
  readonly backendUrl: string;
  readonly gatewayUrl: string;
}

export function readApiEnvironment(projectRoot: string, environment?: { readonly BACKEND_URL?: string }): ApiEnvironment;