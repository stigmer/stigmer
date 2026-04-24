interface NavigatorUABrandVersion {
  brand: string;
  version: string;
}

interface UADataValues {
  architecture?: string;
  bitness?: string;
  model?: string;
  platform?: string;
  platformVersion?: string;
}

interface NavigatorUAData {
  brands: NavigatorUABrandVersion[];
  mobile: boolean;
  platform: string;
  getHighEntropyValues(hints: string[]): Promise<UADataValues>;
}

interface Navigator {
  userAgentData?: NavigatorUAData;
}
