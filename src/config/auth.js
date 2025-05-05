const authConfig = {
  tokenValidation: {
    requiredFields: ['clientName', 'appName', 'stack', 'appUrl'],
    allowedStacks: ['prod', 'staging', 'dev'],
    // Mapping of valid client configurations
    clientConfigs: {
      LAM: {
        allowedApps: ['BrandSystems', 'AssetManager'],
        allowedDomains: ['*.lam.com', '*.lamdev.com'],
        apiKeys: {
          prod: ['key1', 'key2'],
          staging: ['key3'],
          dev: ['key4']
        }
      },
      DAM: {
        allowedApps: ['MediaLibrary', 'ContentHub'],
        allowedDomains: ['*.dam.com', '*.damstaging.com'],
        apiKeys: {
          prod: ['key5', 'key6'],
          staging: ['key7'],
          dev: ['key8']
        }
      }
    }
  }
};

module.exports = authConfig;