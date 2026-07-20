import { invoke } from "@tauri-apps/api/core";
import type { DemoSeedResult, OnboardingStatus } from "./onboarding.types";

export function getOnboardingStatus(): Promise<OnboardingStatus> {
  return invoke<OnboardingStatus>("get_onboarding_status");
}

export function seedDemoData(): Promise<DemoSeedResult> {
  return invoke<DemoSeedResult>("seed_demo_data");
}
