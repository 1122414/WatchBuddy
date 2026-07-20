import { common } from '@kit.AbilityKit';
import { util } from '@kit.ArkTS';

import { WATCHBUDDY_API_BASE_URL } from '../network/ApiConfig';
import {
  CompanionSnapshot,
  DeviceRegistration
} from '../network/ApiModels';
import { WatchBuddyApi } from '../network/WatchBuddyApi';
import { SecureTokenStore } from '../storage/SecureTokenStore';
import {
  LocalIdentity,
  WatchBuddyPreferences
} from '../storage/WatchBuddyPreferences';

export class SessionSyncResult {
  characterState: string;
  nextCheckAt: number;

  constructor(characterState: string, nextCheckAt: number) {
    this.characterState = characterState;
    this.nextCheckAt = nextCheckAt;
  }
}

export class WatchBuddySession {
  private api: WatchBuddyApi =
    new WatchBuddyApi(WATCHBUDDY_API_BASE_URL);
  private localStore: WatchBuddyPreferences;
  private tokenStore: SecureTokenStore = new SecureTokenStore();
  private identity: LocalIdentity | null = null;
  private deviceToken: string = '';

  constructor(context: common.UIAbilityContext) {
    this.localStore = new WatchBuddyPreferences(context);
  }

  isConfigured(): boolean {
    return this.api.isConfigured();
  }

  async restore(): Promise<string> {
    this.identity = await this.localStore.loadIdentity();
    this.deviceToken = await this.tokenStore.load();
    return this.identity.characterState;
  }

  async sync(): Promise<SessionSyncResult> {
    if (!this.api.isConfigured()) {
      throw new Error('service_not_configured');
    }
    if (this.identity === null) {
      await this.restore();
    }
    const identity: LocalIdentity = this.requireIdentity();
    if (this.deviceToken.length === 0) {
      await this.register(identity);
    }
    try {
      const snapshot: CompanionSnapshot =
        await this.api.companionState(this.deviceToken);
      await this.localStore.saveCharacterState(snapshot.characterState);
      return new SessionSyncResult(
        snapshot.characterState,
        snapshot.nextCheckAt
      );
    } catch (error) {
      if (error instanceof Error && error.message === 'http_401') {
        this.deviceToken = '';
        await this.tokenStore.clear();
      }
      throw new Error(
        error instanceof Error ? error.message : 'network_error'
      );
    }
  }

  private async register(identity: LocalIdentity): Promise<void> {
    await this.tokenStore.ensureAvailable();
    let registrationKey: string = identity.registrationKey;
    if (registrationKey.length === 0) {
      registrationKey =
        `register:${util.generateRandomUUID(true).replaceAll('-', '')}`;
      await this.localStore.saveRegistrationKey(registrationKey);
      identity.registrationKey = registrationKey;
    }
    const registration: DeviceRegistration = await this.api.register(
      identity.deviceId,
      -new Date().getTimezoneOffset(),
      registrationKey,
      ''
    );
    await this.tokenStore.save(registration.deviceToken);
    this.deviceToken = registration.deviceToken;
    identity.registrationKey = '';
    await this.localStore.saveRegistrationKey('');
  }

  private requireIdentity(): LocalIdentity {
    if (this.identity === null) {
      throw new Error('identity_not_ready');
    }
    return this.identity;
  }
}
