import {
  createPetInstallPlan,
  parsePetRuntimeManifest,
  petUrisForCleanup
} from './watch-pet-install-plan.js';
import {
  petAssetUri,
  petManifestUri,
  verifyDownloadedPetAsset,
  verifyStoredPetAsset
} from './watch-pet-integrity.js';

const ASSET_PAGE_SIZE = 20;
export const MAX_PET_DOWNLOAD_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 400;

export function installPetBundle(options) {
  const callbacks = options || {};
  const pet = callbacks.pet;
  const previousPet = callbacks.previousPet || null;
  const transport = callbacks.transport;
  const files = callbacks.files;
  const commit = callbacks.commit;
  const onProgress = callbacks.onProgress || function() {};
  const onSuccess = callbacks.onSuccess || function() {};
  const onFailure = callbacks.onFailure || function() {};
  const schedule = callbacks.schedule || function(callback, delayMs) {
    return setTimeout(callback, delayMs);
  };
  const cancelSchedule = callbacks.cancelSchedule || function(timer) {
    clearTimeout(timer);
  };
  let activeRequest = null;
  let cancelled = false;
  let committed = false;
  let descriptors = [];
  let fileOperationPending = false;
  let plan = null;
  let rollingBack = false;
  let retryTimer = null;
  let settled = false;
  const createdFinalUris = [];

  if (!transport
    || typeof transport.listAssets !== 'function'
    || typeof transport.fetchAsset !== 'function'
    || !isValidFileAdapter(files)
    || typeof commit !== 'function') {
    onFailure('invalid_installer');
    return {
      cancel() {}
    };
  }

  function cancelRequest() {
    if (activeRequest && typeof activeRequest.cancel === 'function') {
      activeRequest.cancel();
    }
    activeRequest = null;
  }

  function cancelRetry() {
    if (retryTimer !== null) {
      cancelSchedule(retryTimer);
      retryTimer = null;
    }
  }

  function finishFailure(reason) {
    if (settled || rollingBack || committed) {
      return;
    }
    rollingBack = true;
    cancelRequest();
    cancelRetry();
    const uris = createdFinalUris.slice();
    if (plan) {
      plan.entries.forEach((entry) => uris.push(entry.temporaryUri));
      uris.push(plan.manifestTemporaryUri);
      if (createdFinalUris.indexOf(plan.manifestFinalUri) >= 0) {
        uris.push(plan.manifestFinalUri);
      }
    }
    removeUris(files, uniqueStrings(uris), function() {
      rollingBack = false;
      settled = true;
      onFailure(reason);
    });
  }

  function ensureActive() {
    if (cancelled) {
      finishFailure('cancelled');
      return false;
    }
    return !settled && !rollingBack;
  }

  function loadAssetPage(offset, attempt = 1) {
    if (!ensureActive()) {
      return;
    }
    try {
      activeRequest = transport.listAssets(
        pet,
        ASSET_PAGE_SIZE,
        offset,
        function(page) {
          activeRequest = null;
          if (!ensureActive()) {
            return;
          }
          if (!page
            || !Array.isArray(page.assets)
            || page.nextOffset !== offset + page.assets.length
            || page.nextOffset > page.total
            || page.total !== pet.assetCount) {
            finishFailure('invalid_asset_page');
            return;
          }
          descriptors = descriptors.concat(page.assets);
          if (page.hasMore) {
            loadAssetPage(page.nextOffset);
            return;
          }
          if (descriptors.length !== page.total) {
            finishFailure('incomplete_asset_catalog');
            return;
          }
          beginInstall();
        },
        function(reason) {
          activeRequest = null;
          const failure = reason || 'asset_catalog_failed';
          retryTransient(
            failure,
            attempt,
            () => loadAssetPage(offset, attempt + 1),
            () => finishFailure(failure)
          );
        }
      );
    } catch (error) {
      finishFailure('asset_catalog_failed');
    }
  }

  function beginInstall() {
    try {
      plan = createPetInstallPlan(pet, descriptors, previousPet);
    } catch (error) {
      finishFailure('invalid_install_plan');
      return;
    }
    onProgress(0, plan.entries.length);
    installEntry(0);
  }

  function installEntry(index, attempt = 1) {
    if (!ensureActive()) {
      return;
    }
    if (index >= plan.entries.length) {
      installRuntimeManifest();
      return;
    }
    const entry = plan.entries[index];
    try {
      activeRequest = transport.fetchAsset(
        pet,
        entry.descriptor,
        function(payload) {
          activeRequest = null;
          if (!ensureActive()) {
            return;
          }
          let bytes;
          try {
            bytes = verifyDownloadedPetAsset(payload, entry.descriptor);
          } catch (error) {
            finishFailure('asset_integrity_failed');
            return;
          }
          removeForInstall(entry.temporaryUri, function() {
            writeAndVerifyEntry(index, entry, bytes);
          });
        },
        function(reason) {
          activeRequest = null;
          const failure = reason || 'asset_download_failed';
          retryTransient(
            failure,
            attempt,
            () => installEntry(index, attempt + 1),
            () => finishFailure(failure)
          );
        }
      );
    } catch (error) {
      finishFailure('asset_download_failed');
    }
  }

  function writeAndVerifyEntry(index, entry, bytes) {
    if (!ensureActive()) {
      return;
    }
    runFileOperation(
      (onSuccess, onFailure) => files.writeBuffer(
        entry.temporaryUri,
        bytes,
        onSuccess,
        onFailure
      ),
      function() {
        runFileOperation(
          (onSuccess, onFailure) => files.readBuffer(
              entry.temporaryUri,
              onSuccess,
              onFailure
          ),
          function(storedBytes) {
            try {
              verifyStoredPetAsset(storedBytes, entry.descriptor);
            } catch (error) {
              finishFailure('stored_asset_integrity_failed');
              return;
            }
            removeForInstall(entry.finalUri, function() {
              moveEntry(index, entry);
            });
          },
          () => finishFailure('asset_read_failed')
        );
      },
      () => finishFailure('asset_write_failed')
    );
  }

  function moveEntry(index, entry) {
    if (!ensureActive()) {
      return;
    }
    runFileOperation(
      (onSuccess, onFailure) => files.move(
        entry.temporaryUri,
        entry.finalUri,
        onSuccess,
        onFailure
      ),
      function() {
        createdFinalUris.push(entry.finalUri);
        onProgress(index + 1, plan.entries.length);
        installEntry(index + 1);
      },
      () => finishFailure('asset_move_failed'),
      () => createdFinalUris.push(entry.finalUri)
    );
  }

  function installRuntimeManifest() {
    if (!ensureActive()) {
      return;
    }
    removeForInstall(plan.manifestTemporaryUri, function() {
      runFileOperation(
        (onSuccess, onFailure) => files.writeText(
          plan.manifestTemporaryUri,
          plan.runtimeManifest,
          onSuccess,
          onFailure
        ),
        function() {
          runFileOperation(
            (onSuccess, onFailure) => files.readText(
                plan.manifestTemporaryUri,
                onSuccess,
                onFailure
            ),
            function(storedManifest) {
              if (storedManifest !== plan.runtimeManifest) {
                finishFailure('manifest_integrity_failed');
                return;
              }
              removeForInstall(
                plan.manifestFinalUri,
                moveRuntimeManifest
              );
            },
            () => finishFailure('manifest_read_failed')
          );
        },
        () => finishFailure('manifest_write_failed')
      );
    });
  }

  function moveRuntimeManifest() {
    if (!ensureActive()) {
      return;
    }
    runFileOperation(
      (onSuccess, onFailure) => files.move(
        plan.manifestTemporaryUri,
        plan.manifestFinalUri,
        onSuccess,
        onFailure
      ),
      function() {
        createdFinalUris.push(plan.manifestFinalUri);
        commitSelection();
      },
      () => finishFailure('manifest_move_failed'),
      () => createdFinalUris.push(plan.manifestFinalUri)
    );
  }

  function commitSelection() {
    if (!ensureActive()) {
      return;
    }
    try {
      commit({
        petId: pet.id,
        version: pet.version
      }, function() {
        committed = true;
        const oldUris = previousPet
          ? petUrisForCleanup(previousPet)
          : [];
        removeUris(files, oldUris, function() {
          settled = true;
          onSuccess({
            pet,
            selection: {
              petId: pet.id,
              version: pet.version
            }
          });
        });
      }, function() {
        finishFailure('selection_commit_failed');
      });
    } catch (error) {
      finishFailure('selection_commit_failed');
    }
  }

  function retryTransient(reason, attempt, retry, fail) {
    if (!isTransientFailure(reason)
      || attempt >= MAX_PET_DOWNLOAD_ATTEMPTS) {
      fail();
      return;
    }
    const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
    try {
      retryTimer = schedule(function() {
        retryTimer = null;
        if (!ensureActive()) {
          return;
        }
        retry();
      }, delay);
    } catch (error) {
      fail();
    }
  }

  loadAssetPage(0);

  function runFileOperation(
    operation,
    onSuccess,
    onFailure,
    onCancelledSuccess
  ) {
    fileOperationPending = true;
    let completed = false;
    function succeed(value) {
      if (completed) {
        return;
      }
      completed = true;
      fileOperationPending = false;
      if (cancelled) {
        if (onCancelledSuccess) {
          onCancelledSuccess(value);
        }
        finishFailure('cancelled');
        return;
      }
      onSuccess(value);
    }
    function fail() {
      if (completed) {
        return;
      }
      completed = true;
      fileOperationPending = false;
      if (cancelled) {
        finishFailure('cancelled');
        return;
      }
      onFailure();
    }
    try {
      operation(succeed, fail);
    } catch (error) {
      fail();
    }
  }

  function removeForInstall(uri, callback) {
    runFileOperation(
      (onSuccess) => files.remove(uri, onSuccess),
      callback,
      callback
    );
  }

  return {
    cancel() {
      if (settled || committed) {
        return;
      }
      cancelled = true;
      cancelRequest();
      cancelRetry();
      if (!fileOperationPending) {
        finishFailure('cancelled');
      }
    }
  };
}

export function loadInstalledPet(selection, files, options) {
  const callbacks = options || {};
  const onSuccess = callbacks.onSuccess || function() {};
  const onFailure = callbacks.onFailure || function() {};
  if (!isValidFileAdapter(files)) {
    onFailure('invalid_file_adapter');
    return;
  }
  let uri;
  try {
    uri = petManifestUri(selection && selection.version);
  } catch (error) {
    onFailure('invalid_selection');
    return;
  }
  callFileOperation(
    () => files.readText(
      uri,
      function(value) {
        let pet;
        try {
          pet = parsePetRuntimeManifest(value, selection);
        } catch (error) {
          onFailure('invalid_runtime_manifest');
          return;
        }
        let fallbackUri;
        try {
          fallbackUri = petAssetUri(pet.version, pet.preview.assetId);
        } catch (error) {
          onFailure('invalid_runtime_manifest');
          return;
        }
        callFileOperation(
          () => files.readBuffer(
            fallbackUri,
            function(bytes) {
              try {
                verifyStoredPetAsset(bytes, pet.preview);
              } catch (error) {
                onFailure('fallback_asset_invalid');
                return;
              }
              onSuccess(pet);
            },
            () => onFailure('fallback_asset_missing')
          ),
          () => onFailure('fallback_asset_missing')
        );
      },
      () => onFailure('runtime_manifest_missing')
    ),
    () => onFailure('runtime_manifest_missing')
  );
}

function isValidFileAdapter(files) {
  return files
    && typeof files.move === 'function'
    && typeof files.readBuffer === 'function'
    && typeof files.readText === 'function'
    && typeof files.remove === 'function'
    && typeof files.writeBuffer === 'function'
    && typeof files.writeText === 'function';
}

function callFileOperation(operation, onThrow) {
  try {
    operation();
  } catch (error) {
    onThrow();
  }
}

function removeIgnoringFailure(files, uri, callback) {
  try {
    files.remove(uri, callback);
  } catch (error) {
    callback(false);
  }
}

function removeUris(files, uris, callback) {
  let index = 0;
  function next() {
    if (index >= uris.length) {
      callback();
      return;
    }
    const uri = uris[index];
    index += 1;
    removeIgnoringFailure(files, uri, next);
  }
  next();
}

function uniqueStrings(values) {
  const seen = Object.create(null);
  return values.filter((value) => {
    if (!value || seen[value]) {
      return false;
    }
    seen[value] = true;
    return true;
  });
}

function isTransientFailure(reason) {
  return reason === 'network_error'
    || reason === 'timeout'
    || reason === 'http_429'
    || reason === 'http_500'
    || reason === 'http_502'
    || reason === 'http_503'
    || reason === 'http_504';
}
