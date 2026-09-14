import { requireOptionalNativeModule } from "expo-modules-core";
import { Platform } from "react-native";
import type { CompanyBrandingPort } from "../../src/branding/contracts";

export default Platform.OS === "android" ? requireOptionalNativeModule<CompanyBrandingPort>("CompanyBranding") : null;