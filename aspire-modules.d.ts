// Fallback declarations for the Aspire-generated TypeScript modules.
//
// The real, full type surface lives in `.modules/aspire.ts` after running
// `aspire restore`. That folder is gitignored, so this hand-maintained
// `.d.ts` keeps `tsconfig.apphost.json` happy in clean checkouts (CI
// cold-starts, fresh worktrees) by declaring only the methods `apphost.ts`
// actually calls. Add to this file whenever `apphost.ts` calls a new
// Aspire API — and prefer running `aspire restore` locally to get the
// full generated surface for development.
declare module './.modules/aspire.js' {
  enum EndpointProperty {
    Url = 'Url',
    Host = 'Host',
    IPV4Host = 'IPV4Host',
    Port = 'Port',
    Scheme = 'Scheme',
    TargetPort = 'TargetPort',
    HostAndPort = 'HostAndPort',
    TlsEnabled = 'TlsEnabled',
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
      callback: (ctx: {
        logger: { get(): Promise<{ logInformation(message: string): Promise<void> }> };
      }) => Promise<{ success: boolean; errorMessage?: string }>,
    ): Promise<void>;
  }

  interface ExecutableResource {
    withHttpEndpoint(options: { port: number; targetPort: number; isProxied: boolean }): ExecutableResource;
    withEnvironment(name: string, value: string | EndpointReferenceExpression): ExecutableResource;
    getEndpoint(name: string): Promise<EndpointReference>;
  }

  interface AspireBuilder {
    addAzureContainerAppEnvironment(name: string): AzureContainerAppEnvironmentResource;
    addNextJsApp(name: string, appDirectory: string, options?: { runScriptName?: string }): NextJsAppResource;
    addExecutable(name: string, command: string, workingDirectory: string, args: string[]): ExecutableResource;
    build(): {
      run(): Promise<void>;
    };
  }

  export function createBuilder(): Promise<AspireBuilder>;
  export { EndpointProperty };
}
