import { common } from '@kit.AbilityKit';
import { preferences } from '@kit.ArkData';
import { util } from '@kit.ArkTS';

import { isCharacterState, isValidDeviceId } from '../network/ApiModels';
import {
  isValidPetId,
  isValidPetVersion
} from '../network/ApiModels';

const PREFERENCES_NAME: string = 'watchbuddy';
const DEVICE_ID_KEY: string = 'device_id';
const REGISTRATION_KEY: string = 'registration_idempotency_key';
const CHARACTER_STATE_KEY: string = 'character_state';
const PET_SELECTION_KEY: string = 'pet_selection';
const PENDING_REPLY_KEY: string = 'pending_quick_reply';

interface PetSelectionPayload {
  petId: string;
  version: string;
}

interface PendingQuickReplyPayload {
  nudgeId: string;
  actionId: string;
  idempotencyKey: string;
  attempts: number;
  nextAttemptAt: number;
}

export class LocalIdentity {
  deviceId: string;
  registrationKey: string;
  characterState: string;

  constructor(deviceId: string, registrationKey: string, characterState: string) {
    this.deviceId = deviceId;
    this.registrationKey = registrationKey;
    this.characterState = characterState;
  }
}

export class PetSelection {
  petId: string;
  version: string;

  constructor(petId: string, version: string) {
    this.petId = petId;
    this.version = version;
  }

  isDownloaded(): boolean {
    return isValidPetId(this.petId) && isValidPetVersion(this.version);
  }
}

export class PendingQuickReply {
  nudgeId: string;
  actionId: string;
  idempotencyKey: string;
  attempts: number;
  nextAttemptAt: number;

  constructor(
    nudgeId: string,
    actionId: string,
    idempotencyKey: string,
    attempts: number,
    nextAttemptAt: number
  ) {
    this.nudgeId = nudgeId;
    this.actionId = actionId;
    this.idempotencyKey = idempotencyKey;
    this.attempts = attempts;
    this.nextAttemptAt = nextAttemptAt;
  }

  isValid(): boolean {
    return /^[A-Za-z0-9_-]{8,64}$/.test(this.nudgeId)
      && /^[A-Za-z0-9_-]{1,24}$/.test(this.actionId)
      && /^[A-Za-z0-9._:-]{8,128}$/.test(this.idempotencyKey)
      && Number.isInteger(this.attempts)
      && this.attempts >= 0
      && this.attempts <= 3
      && Number.isSafeInteger(this.nextAttemptAt)
      && this.nextAttemptAt >= 0;
  }
}

export class WatchBuddyPreferences {
  private context: common.UIAbilityContext;

  constructor(context: common.UIAbilityContext) {
    this.context = context;
  }

  async loadIdentity(): Promise<LocalIdentity> {
    try {
      const store: preferences.Preferences =
        await preferences.getPreferences(this.context, PREFERENCES_NAME);
      const storedDeviceId: preferences.ValueType =
        await store.get(DEVICE_ID_KEY, '');
      const storedRegistrationKey: preferences.ValueType =
        await store.get(REGISTRATION_KEY, '');
      const storedState: preferences.ValueType =
        await store.get(CHARACTER_STATE_KEY, 'idle');
      let deviceId: string = typeof storedDeviceId === 'string'
        ? storedDeviceId
        : '';
      if (!isValidDeviceId(deviceId)) {
        deviceId = `gt6pro-${util.generateRandomUUID(true).replaceAll('-', '')}`;
        await store.put(DEVICE_ID_KEY, deviceId);
        await store.flush();
      }
      const registrationKey: string =
        typeof storedRegistrationKey === 'string'
          ? storedRegistrationKey
          : '';
      const characterState: string = typeof storedState === 'string'
        && isCharacterState(storedState)
        ? storedState
        : 'idle';
      return new LocalIdentity(deviceId, registrationKey, characterState);
    } catch (error) {
      throw new Error('preferences_read_failed');
    }
  }

  async saveRegistrationKey(value: string): Promise<void> {
    await this.saveString(REGISTRATION_KEY, value);
  }

  async saveCharacterState(value: string): Promise<void> {
    if (!isCharacterState(value)) {
      throw new Error('invalid_character_state');
    }
    await this.saveString(CHARACTER_STATE_KEY, value);
  }

  async loadPetSelection(): Promise<PetSelection> {
    try {
      const store: preferences.Preferences =
        await preferences.getPreferences(this.context, PREFERENCES_NAME);
      const storedSelection: preferences.ValueType =
        await store.get(PET_SELECTION_KEY, '');
      if (typeof storedSelection !== 'string'
        || storedSelection.length < 1
        || storedSelection.length > 160) {
        return new PetSelection('', '');
      }
      const payload: PetSelectionPayload =
        JSON.parse(storedSelection) as PetSelectionPayload;
      if (!payload
        || !isValidPetId(payload.petId)
        || !isValidPetVersion(payload.version)) {
        return new PetSelection('', '');
      }
      return new PetSelection(payload.petId, payload.version);
    } catch (error) {
      return new PetSelection('', '');
    }
  }

  async savePetSelection(selection: PetSelection): Promise<void> {
    if (!selection.isDownloaded()) {
      throw new Error('invalid_pet_selection');
    }
    const payload: PetSelectionPayload = {
      petId: selection.petId,
      version: selection.version
    };
    await this.saveString(PET_SELECTION_KEY, JSON.stringify(payload));
  }

  async clearPetSelection(): Promise<void> {
    await this.saveString(PET_SELECTION_KEY, '');
  }

  async loadPendingQuickReply(): Promise<PendingQuickReply | null> {
    try {
      const store: preferences.Preferences =
        await preferences.getPreferences(this.context, PREFERENCES_NAME);
      const storedValue: preferences.ValueType =
        await store.get(PENDING_REPLY_KEY, '');
      if (typeof storedValue !== 'string'
        || storedValue.length < 1
        || storedValue.length > 512) {
        return null;
      }
      const payload: PendingQuickReplyPayload =
        JSON.parse(storedValue) as PendingQuickReplyPayload;
      const pending: PendingQuickReply = new PendingQuickReply(
        payload.nudgeId,
        payload.actionId,
        payload.idempotencyKey,
        payload.attempts,
        payload.nextAttemptAt
      );
      return pending.isValid() ? pending : null;
    } catch (error) {
      return null;
    }
  }

  async savePendingQuickReply(value: PendingQuickReply): Promise<void> {
    if (!value.isValid()) {
      throw new Error('invalid_pending_reply');
    }
    const payload: PendingQuickReplyPayload = {
      nudgeId: value.nudgeId,
      actionId: value.actionId,
      idempotencyKey: value.idempotencyKey,
      attempts: value.attempts,
      nextAttemptAt: value.nextAttemptAt
    };
    await this.saveString(PENDING_REPLY_KEY, JSON.stringify(payload));
  }

  async clearPendingQuickReply(): Promise<void> {
    await this.saveString(PENDING_REPLY_KEY, '');
  }

  private async saveString(key: string, value: string): Promise<void> {
    try {
      const store: preferences.Preferences =
        await preferences.getPreferences(this.context, PREFERENCES_NAME);
      await store.put(key, value);
      await store.flush();
    } catch (error) {
      throw new Error('preferences_write_failed');
    }
  }
}
