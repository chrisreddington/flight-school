declare module './.modules/aspire.js' {
  enum EndpointProperty {
    Url = "Url",
    Host = "Host",
    IPV4Host = "IPV4Host",
    Port = "Port",
    Scheme = "Scheme",
    TargetPort = "TargetPort",
    HostAndPort = "HostAndPort",
    TlsEnabled = "TlsEnabled",
  }

  type EndpointReferenceExpression = object;

  interface EndpointReference {
    property(property: EndpointProperty): Promise<EndpointReferenceExpression>;
    url(): Promise<string>;
  }

  interface AzureContainerAppEnvironmentResource {
    withAzdResourceNaming(): Promise<void>;
  }

  interface NextJsAppResource {
    withExternalHttpEndpoints(): Promise<NextJsAppResource>;
    withHttpEndpoint(options: { port: number; targetPort: number; isProxied: boolean }): NextJsAppResource;
    withEnvironment(name: string, value: string | EndpointReferenceExpression): NextJsAppResource;
    getEndpoint(name: string): Promise<EndpointReference>;
    withCommand(
      name: string,
      displayName: string,
      callback: (ctx: { logger: { get(): Promise<{ logInformation(message: string): Promise<void> }> } }) => Promise<{ success: boolean; errorMessage?: string }>,
    ): Promise<void>;
  }

  interface AspireBuilder {
    addAzureContainerAppEnvironment(name: string): AzureContainerAppEnvironmentResource;
    addNextJsApp(
      name: string,
      appDirectory: string,
      options?: { runScriptName?: string }
    ): NextJsAppResource;
    build(): {
      run(): Promise<void>;
    };
  }

  export function createBuilder(): Promise<AspireBuilder>;
  export { EndpointProperty };
}
