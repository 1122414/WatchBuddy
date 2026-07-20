import { common } from '@kit.AbilityKit';
import { util } from '@kit.ArkTS';

import { WATCHBUDDY_API_BASE_URL } from '../network/ApiConfig';
import {
  CompanionNudge,
  CompanionSnapshot,
  DeviceRegistration,
  MemoryPage,
  PetCatalog,
  PetSummary,
  ReplyResult,
  SettingsResult
} from '../network/ApiModels';
import { WatchBuddyApi } from '../network/WatchBuddyApi';
import {
  InstalledPetBundle,
  PetInstaller
} from '../pet/PetInstaller';
import { SecureTokenStore } from '../storage/SecureTokenStore';
import {
  LocalIdentity,
  PendingQuickReply,
  WatchBuddyPreferences
} from '../storage/WatchBuddyPreferences';

const MAX_REPLY_ATTEMPTS: number = 3;
const REPLY_RETRY_BASE_MS: number = 400;

export class SessionSyncResult {
  characterState: string;
  nextCheckAt: number;
  quietMode: boolean;
  nudge: CompanionNudge | null;

  constructor(
    characterState: string,
    nextCheckAt: number,
    quietMode: boolean,
    nudge: CompanionNudge | null
  ) {
    this.characterState = characterState;
    this.nextCheckAt = nextCheckAt;
    this.quietMode = quietMode;
    this.nudge = nudge;
  }
}

export class WatchBuddySession {
  private api: WatchBuddyApi =
    new WatchBuddyApi(WATCHBUDDY_API_BASE_URL);
  private localStore: WatchBuddyPreferences;
  private tokenStore: SecureTokenStore = new SecureTokenStore();
  private identity: LocalIdentity | null = null;
  private deviceToken: string = '';
  private petInstaller: PetInstaller;

  constructor(context: common.UIAbilityContext) {
    this.localStore = new WatchBuddyPreferences(context);
    this.petInstaller = new PetInstaller(
      context,
      this.api,
      this.localStore
    );
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
    await this.ensureRegistered(identity);
    try {
      await this.flushPendingQuickReply();
      const snapshot: CompanionSnapshot =
        await this.api.companionState(this.deviceToken);
      await this.localStore.saveCharacterState(snapshot.characterState);
      return new SessionSyncResult(
        snapshot.characterState,
        snapshot.nextCheckAt,
        snapshot.quietMode,
        snapshot.nudge
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

  async setQuietMode(quietMode: boolean): Promise<boolean> {
    await this.ensureOnlineIdentity();
    try {
      const result: SettingsResult =
        await this.api.updateSettings(this.deviceToken, quietMode);
      return result.quietMode;
    } catch (error) {
      await this.handleAuthorizationFailure(error);
      throw new Error(
        error instanceof Error ? error.message : 'settings_failed'
      );
    }
  }

  async replyToNudge(
    nudgeId: string,
    actionId: string
  ): Promise<ReplyResult> {
    await this.ensureOnlineIdentity();
    const pending: PendingQuickReply = new PendingQuickReply(
      nudgeId,
      actionId,
      `reply:${util.generateRandomUUID(true).replaceAll('-', '')}`,
      0,
      Date.now()
    );
    await this.localStore.savePendingQuickReply(pending);
    return await this.deliverPendingQuickReply(pending, true);
  }

  async memories(limit: number, offset: number): Promise<MemoryPage> {
    await this.ensureOnlineIdentity();
    try {
      return await this.api.memories(
        this.deviceToken,
        limit,
        offset
      );
    } catch (error) {
      await this.handleAuthorizationFailure(error);
      throw new Error(
        error instanceof Error ? error.message : 'memories_failed'
      );
    }
  }

  async deleteMemory(memoryId: string): Promise<void> {
    await this.ensureOnlineIdentity();
    try {
      await this.api.deleteMemory(this.deviceToken, memoryId);
    } catch (error) {
      await this.handleAuthorizationFailure(error);
      throw new Error(
        error instanceof Error ? error.message : 'memory_delete_failed'
      );
    }
  }

  async clearMemories(): Promise<number> {
    await this.ensureOnlineIdentity();
    try {
      return await this.api.clearMemories(this.deviceToken);
    } catch (error) {
      await this.handleAuthorizationFailure(error);
      throw new Error(
        error instanceof Error ? error.message : 'memory_clear_failed'
      );
    }
  }

  async loadPetCatalog(): Promise<PetCatalog> {
    if (!this.api.isConfigured()) {
      throw new Error('service_not_configured');
    }
    if (this.identity === null) {
      await this.restore();
    }
    await this.ensureRegistered(this.requireIdentity());
    try {
      return await this.api.petCatalog(this.deviceToken);
    } catch (error) {
      await this.handleAuthorizationFailure(error);
      throw new Error(
        error instanceof Error ? error.message : 'network_error'
      );
    }
  }

  async loadInstalledPet(): Promise<InstalledPetBundle | null> {
    return await this.petInstaller.loadInstalled();
  }

  async installPet(
    summary: PetSummary,
    onProgress: (completed: number, total: number) => void
  ): Promise<InstalledPetBundle> {
    if (!this.api.isConfigured()) {
      throw new Error('service_not_configured');
    }
    if (this.identity === null) {
      await this.restore();
    }
    await this.ensureRegistered(this.requireIdentity());
    try {
      return await this.petInstaller.install(
        this.deviceToken,
        summary,
        onProgress
      );
    } catch (error) {
      await this.handleAuthorizationFailure(error);
      throw new Error(
        error instanceof Error ? error.message : 'pet_install_failed'
      );
    }
  }

  private async ensureRegistered(identity: LocalIdentity): Promise<void> {
    if (this.deviceToken.length === 0) {
      await this.register(identity);
    }
  }

  private async ensureOnlineIdentity(): Promise<void> {
    if (!this.api.isConfigured()) {
      throw new Error('service_not_configured');
    }
    if (this.identity === null) {
      await this.restore();
    }
    await this.ensureRegistered(this.requireIdentity());
  }

  private async flushPendingQuickReply(): Promise<void> {
    const pending: PendingQuickReply | null =
      await this.localStore.loadPendingQuickReply();
    if (pending === null) {
      return;
    }
    if (pending.attempts >= MAX_REPLY_ATTEMPTS) {
      pending.attempts = 0;
      pending.nextAttemptAt = Date.now();
      await this.localStore.savePendingQuickReply(pending);
    }
    try {
      await this.deliverPendingQuickReply(pending, false);
    } catch (error) {
      if (error instanceof Error && error.message === 'http_401') {
        throw new Error(
          error.message
        );
      }
    }
  }

  private async deliverPendingQuickReply(
    pending: PendingQuickReply,
    exhaustRetries: boolean
  ): Promise<ReplyResult> {
    while (pending.attempts < MAX_REPLY_ATTEMPTS) {
      const waitMs: number = Math.max(0, pending.nextAttemptAt - Date.now());
      if (waitMs > 0) {
        await delay(waitMs);
      }
      try {
        const result: ReplyResult = await this.api.quickReply(
          this.deviceToken,
          pending.nudgeId,
          pending.actionId,
          pending.idempotencyKey
        );
        await this.localStore.clearPendingQuickReply();
        await this.localStore.saveCharacterState(result.characterState);
        return result;
      } catch (error) {
        await this.handleAuthorizationFailure(error);
        if (error instanceof Error && error.message === 'http_401') {
          await this.localStore.savePendingQuickReply(pending);
          throw new Error(error.message);
        }
        if (!isTransientReplyFailure(error)) {
          await this.localStore.clearPendingQuickReply();
          throw new Error(
            error instanceof Error ? error.message : 'reply_failed'
          );
        }
        pending.attempts += 1;
        pending.nextAttemptAt = Date.now()
          + REPLY_RETRY_BASE_MS * Math.pow(2, pending.attempts - 1);
        await this.localStore.savePendingQuickReply(pending);
        if (!exhaustRetries) {
          throw new Error('network_error');
        }
      }
    }
    throw new Error('reply_retry_exhausted');
  }

  private async handleAuthorizationFailure(error: Object): Promise<void> {
    if (error instanceof Error && error.message === 'http_401') {
      this.deviceToken = '';
      await this.tokenStore.clear();
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

function isTransientReplyFailure(error: Object): boolean {
  return error instanceof Error
    && (error.message === 'network_error'
      || error.message === 'http_429'
      || error.message === 'http_500'
      || error.message === 'http_502'
      || error.message === 'http_503'
      || error.message === 'http_504');
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, milliseconds);
  });
}
