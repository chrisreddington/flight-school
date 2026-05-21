declare module './.modules/aspire.js' {
  interface AzureContainerAppEnvironmentResource {
    withAzdResourceNaming(): Promise<void>;
  }

  interface NextJsAppResource {
    withExternalHttpEndpoints(): Promise<NextJsAppResource>;
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
}
