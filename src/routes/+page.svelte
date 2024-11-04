<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import type { ComponentType } from 'svelte';
  import { writable } from 'svelte/store';
  import { propertyStore } from 'svelte-writable-derived'; 
  import { beforeNavigate } from "$app/navigation";
  import { browser } from '$app/environment';
  import { base } from '$app/paths';  
  import Device from 'svelte-device-info';
  import { pulseEditorBackground } from '$lib';
  import type { editor } from 'monaco-editor';

  import { cfg } from '$root/webui.config.js';
  import { Log } from '$lib';
  import * as ds from '$lib/stores/doc_session';
  import * as km from '$lib/keymap';

  import * as harbor from '$lib/harbor';
  import { StackTrace } from '$lib/stores';
  import { StackTraceTable } from '$lib/components';

  // Global state
  import { 
    currentView,
    paneSizes,
    isAutoBuild,
    isFullscreen,
    orientationLandscape,
    isReadOnly,
    isDark,
    isReady,
    isPlaying,
  } from '$lib/stores';

  // Sessions
  let dsCurrentSession;
  const unsubscribeDocSession = ds.documentSession.subscribe(session => {
    dsCurrentSession = session;
  });

  // Handlers
  import { 
    DocHandler, 
    NavHandler,
    ScreenHandler,
    MobileHandler
  } from '$lib';

  let docHandler;     // Document actions (e.g. update, save, new, rename, make read-only)
  let navHandler;     // SPA "navigation"
  let screenHandler;  // Fullscreen
  let mobileHandler;  // Mobile-specific UI handling

  // I/O observers  
  import { observeKeyboard } from '$lib/keybind';
  let resizeObserver;
  let viewportEl;

  // Core components
  import { MonacoEditor, AnchorLightSwitch, AnchorScriptStatus, DocTitleBadge, DocMenuBadge }  from '$lib/components';
  import * as panes from '$lib/panes';

  // Modals, Drawers
  import { getModalStore, getDrawerStore } from '@skeletonlabs/skeleton';
  const modalStore = getModalStore();
  const drawerStore = getDrawerStore();
  import * as modals from '$lib/modals';

  import { drawerContentStore } from '$lib/stores/drawer';
  import DrawerArchive from '$lib/components/drawer_archive.svelte';
  import { get } from 'svelte/store';
  const drawerSettings: DrawerSettings = {
    id: 'archive-drawer',
    width: 'w-[340px] md:w-[720px]',
    padding: 'p-0',
    position: 'right',
  };

  let monacoEditor: editor.IStandaloneCodeEditor;

  // Unsaved changes guardrails
  beforeNavigate(({ cancel }) => {
    if (dsCurrentSession.unsavedChanges) {
      if (!confirm('You are about to navigate away, but you have unsaved changes. Proceed?')) {
        cancel();
      }
    }
  });

  // Create a promise to wait for the editor instance
  const waitForEditorInstance = () => {
    return new Promise((resolve) => {
      // This callback is passed to the Monaco component
      setEditorInstance = (instance) => {
        monacoEditor = instance.detail;
        resolve(monacoEditor);  // Resolve promise when editor is ready
      };
    });
  };

  let setEditorInstance;

  const waitForEvent = async (eventType) => {
    return new Promise((resolve) => {
      window.addEventListener(eventType, resolve, { once: true });
    });
  };

  const waitForCanvas = () => {
    if (!$isReady){;
      return new Promise((resolve) => {
          const unsubscribe = isReady.subscribe((val) => {
              if (val === true) {
                  unsubscribe();
                  resolve();
              }
          });
      });
    }
    return true;
  };

  // UI actions   
  const reqOpenArchiveDrawer = async () => {
    if (!$drawerStore.open){
      await reqStopAnimation();
      await docHandler.refreshDocList();
      drawerContentStore.set({
        id: 'archive',
        component: DrawerArchive,
        props: {
          deleteDocCallback: reqDeleteDoc,
          loadDocCallback: reqLoadDoc,
          saveDocCallback: reqSaveDoc,
          saveDocNewVersionCallback: reqSaveDocNewVersion,
        },
      });
      drawerStore.open(drawerSettings);
    } else {
      drawerStore.close();
    }
  };

  const reqResetPanes = () => paneSizes.set({...panes.resetPaneSizes()});

  let autoBuildTimeoutID: number;

  const canvasReady = () => {
    $isReady = true;
  };

  const buildSuccess = () => {
    Log.scriptSuccess("build completed");
    const flashCol = $isDark ? cfg.BUILD_COL_SUCCESS[0] : cfg.BUILD_COL_SUCCESS[1];
    pulseEditorBackground(flashCol, cfg.BUILD_FLASH_DUR);
    $isPlaying = true;
  };

  const buildError = () => {
    const flashCol = $isDark ? cfg.BUILD_COL_FAILURE[0] : cfg.BUILD_COL_FAILURE[1];
    pulseEditorBackground(flashCol, cfg.BUILD_FLASH_DUR);
    $isPlaying = false;
  };

  const reqBuild = async () => {
    await reqClearStopAnimation();
    let buildSuccessful = true;
    let editorVal = monacoEditor.getValue();

    await waitForCanvas();
    let canvasframe = document.querySelector("#canvasframe");
    let canvasframeWindow = canvasframe.contentWindow;

    // we don't want to separately message and wait for a resize request
    const el = document.querySelector('#ct2');
    const {width, height} = el.getBoundingClientRect();
    canvasframe.width = width;
    canvasframe.height = height;

    harbor.txBuild(canvasframeWindow, editorVal, width, height);
  };

  const reqStopAnimation = async () => {
    if (!$isPlaying) return;
    $isPlaying = false;
    await waitForCanvas();
    let canvasframe = document.querySelector("#canvasframe");
    let canvasframeWindow = canvasframe.contentWindow;
    harbor.txStop(canvasframeWindow);
    await waitForEvent('render-stopped');
  };

  const handleLayoutChange = async () => {
    await waitForCanvas();
    // Can't do txRestart because iframe gets reloaded and script cache lost --
    // presumably there's some security logic here.
    if ($isPlaying) {
      await reqBuild();
    }
  };

  const reqClearStopAnimation = async () => {
    Log.clearScriptLog();
    StackTrace.clear();
    await reqStopAnimation();
  };
  const reqResize = (reqWidth = null, reqHeight = null) => {
    let width = 0;
    let height = 0;
    if (reqWidth === null || reqHeight === null) {
      const el = document.querySelector('#ct2');
      const rectEl = el.getBoundingClientRect();
      width = rectEl.width;
      height = rectEl.height;
      Log.debug(`Resizing to ${width}x${height} of `, el);
    } else {
      width = reqWidth;
      height = reqHeight;
    }    
    let canvasframe = document.querySelector("#canvasframe");
    let canvasframeWindow = canvasframe.contentWindow;
    canvasframe.width = width;
    canvasframe.height = height;
    harbor.txResize(canvasframeWindow, width, height);
  };

  const reqNewDoc = async () => {
    if (dsCurrentSession.unsavedChanges){
      modalStore.trigger({
        ...modals.modalConfirm, 
        message: "Unsaved changes will be discarded. Create a new script anyway?",
        txtConfirm: "New Script",
        onConfirm: docHandler.newDoc
      });
    } else {
      docHandler.newDoc();
    }
    await reqClearStopAnimation();
  };

  const reqLoadDoc = async (uuid: string, adapter: string) => {
    await reqClearStopAnimation();
    if (dsCurrentSession.unsavedChanges){
      modalStore.trigger({
        ...modals.modalConfirm, 
        message: "Unsaved changes will be discarded. Load a new script anyway?",
        txtConfirm: "Load Script",
        onConfirm: async () => { 
          await docHandler.loadDoc(uuid, adapter); 
          drawerStore.close(); 
        },
      });
    } else {
      docHandler.loadDoc(uuid, adapter); 
      drawerStore.close();
    }
    // wait for pane animation to complete
    setTimeout(reqBuild, 350);
  };

  const reqForkDoc = async () => {
    if (dsCurrentSession.unsavedChanges){
      modalStore.trigger({
        ...modals.modalConfirm, 
        message: "Unsaved changes will be discarded. Fork script anyway?",
        txtConfirm: "Fork Script",
        onConfirm: docHandler.forkDoc,
      });
    } else {
      docHandler.forkDoc();
    }
    reqRenameDoc();
    await reqClearStopAnimation();
  };

  const reqImportFile = async (content: string, baseFilename?: string) => {
    if (dsCurrentSession.unsavedChanges){
      modalStore.trigger({
        ...modals.modalConfirm, 
        message: "Unsaved changes will be discarded. Import file anyway?",
        txtConfirm: "Import File",
        onConfirm: () => { docHandler.newDoc(content, baseFilename ?? ''); },
      });
    } else {
      docHandler.newDoc(content, baseFilename ?? '');
    }
    modalStore.close();
    reqRenameDoc(baseFilename ?? '');
    await reqClearStopAnimation();
  };

  const reqExportFile = () => {
    let content:string = docHandler.getCurrentEditorContent();
    let filename = dsCurrentSession.docName;
    const blob = new Blob([content], { type: "application/octet-stream" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename.trim().replace(/[\/:*?"<>|]/g, "")+cfg.PWA_FILE_EXT;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  };

  const reqSaveDoc = async () => {
    if (dsCurrentSession.unsavedChanges) {
      if (dsCurrentSession.versionActive != dsCurrentSession.versionCount - 1) {
        modalStore.trigger({
          ...modals.modalConfirm, 
          message: `You are saving over an old version. Overwrite it?`,
          txtConfirm: `Overwrite v${dsCurrentSession.versionActive}`,
          txtCancel: `Save as v${dsCurrentSession.versionCount}`,
          onConfirm: async () => { await docHandler.saveDoc() },
          onCancel: reqSaveDocNewVersion,
        });
      } else { 
        await docHandler.saveDoc(); 
        await docHandler.refreshDocList(); 
      }
    } else { Log.toastInfo('no changes to save') }
    await reqBuild();
  };

  const reqSaveDocNewVersion = async () => {
    if (dsCurrentSession.unsavedChanges) {
      await docHandler.saveDocNewVersion();
      docHandler.loadLastVersion();
      docHandler.refreshDocList();
    } else { Log.toastInfo('no changes to save') }
    await reqBuild();
  };

  const reqDeleteDoc = async (uuid: string, adapter: string) => {
    modalStore.trigger({
      ...modals.modalConfirm, 
      message: "Delete script?",
      txtConfirm: "Delete",
      onConfirm: async () => { 
        await docHandler.deleteDoc(uuid, adapter);
        await docHandler.refreshDocList();
      },
    });
  };

  const reqSwitchDocVersion = async (v) => {
    if (dsCurrentSession.unsavedChanges){
      modalStore.trigger({
        ...modals.modalConfirm, 
        message: "Unsaved changes will be discarded. Load version anyway?",
        txtConfirm: `Switch to v${v}`,
        onConfirm: () => { docHandler.loadVersion(parseInt(v)); },
      });
    } else {
      docHandler.loadVersion(parseInt(v));
    }
    await reqClearStopAnimation();
  };

  const reqRevertDoc = async () => {
    if (dsCurrentSession.unsavedChanges){
      modalStore.trigger({
        ...modals.modalConfirm, 
        message: "Revert to last saved changes?",
        txtConfirm: `Revert`,
        onConfirm: () => { docHandler.loadVersion(parseInt(dsCurrentSession.versionActive)); },
      });
    } else {
      Log.toastInfo('no changes to revert')
    }
    await reqClearStopAnimation();
  }

  const reqRenameDoc = async (name?: string) => {
    modalStore.trigger({
      ...modals.modalInput, 
      message: 'What shall we call this?',
      placeholder: 'Script Name',
      inputValue: typeof name === 'string' ? name : dsCurrentSession.docName,
      txtConfirm: 'Rename',
      onConfirm: (inputVal) => { docHandler.renameDoc(inputVal); }
    })
    await reqClearStopAnimation();
  };

  const reqSaveMenu = async () => {
    modalStore.trigger({
      ...modals.modalSave, 
      session: dsCurrentSession,
      localSaveDocCallback: reqSaveDoc,
      localSaveDocNewVersionCallback: reqSaveDocNewVersion,
    })
  };

  // When browser stuff is available
  onMount(async () => {      
    if (typeof ResizeObserver === 'undefined') {
      const { ResizeObserver } = await import('resize-observer-polyfill');
    }
    if (browser) {
      document.querySelector('body').setAttribute('data-theme', cfg.APP_THEME);

      // canvasframe = document.querySelector("#canvasframe");
      // canvasframeWindow = canvasframe.contentWindow;
      // canvasframeWindow.console.error = (e) => Log.scriptError(e);

      await waitForEditorInstance(); 
      $isReady = true;
      
      // Listen for changes in Monaco editor and update the store
      monacoEditor.onDidChangeModelContent(() => {
        const content = monacoEditor.getValue();
        docHandler.updateDoc(content);
        if ($isAutoBuild) {
          clearTimeout(autoBuildTimeoutID);   
          autoBuildTimeoutID = setTimeout(reqBuild, cfg.AUTOBUILD_DELAY);
        }
      });

      // Populate panes
      panes.returnContentToSplit();
      
      // Set up handlers
      docHandler    = new DocHandler(dsCurrentSession, monacoEditor);
      navHandler    = new NavHandler({layoutChangeCallback: handleLayoutChange});
      screenHandler = new ScreenHandler(window);
      mobileHandler = new MobileHandler(window, {layoutChangeCallback: handleLayoutChange});

      // Check if an uploaded file exists in sessionStorage
      const fileData = sessionStorage.getItem('importRequestFile'); 
      sessionStorage.removeItem('importRequestFile');
      const importRequestView = sessionStorage.getItem('importRequestView');
      if (importRequestView !== null && +importRequestView <= 3 && +importRequestView >= 0) {
        $currentView = parseInt(importRequestView);
        sessionStorage.removeItem('importRequestView');
      }
      const importRequestAutoBuild = sessionStorage.getItem('importRequestAutoBuild');
      if (importRequestAutoBuild !== null) {
        isAutoBuild.set(!!+importRequestAutoBuild)
        sessionStorage.removeItem('importRequestAutoBuild');
      }
      const importRequestReadOnly = sessionStorage.getItem('importRequestReadOnly');
      if (importRequestReadOnly !== null) {
        !!+importRequestReadOnly ? docHandler.disableEditing() : docHandler.enableEditing();
        sessionStorage.removeItem('importRequestReadOnly');
      }

      let contentToLoad; 
      if (fileData) {
        const file = JSON.parse(fileData);
        contentToLoad = file[0].content || null; 
      }


      docHandler.newDoc(contentToLoad);

      // Listen for orientation changes and do initial check
      window.screen.orientation.onchange = () => {
        // Don't shorten to just arrow - this has to be in curlies... for some reason.
        mobileHandler.orientationChange();
      };
      mobileHandler.orientationChange();

      // Turn off editing by default on mobile devices, because soft keys suck
      if (Device.isMobile && cfg.MOBILE_READONLY) docHandler.disableEditing();

      harbor.rxListen();

      // Observe viewport resize
      resizeObserver = new ResizeObserver(entries => {
        for (let entry of entries) {
          const { width, height } = entry.contentRect;
          reqResize(width, height);
        }
      });
      viewportEl = document.querySelector('#ct2');
      resizeObserver.observe(viewportEl);


      // Custom events from keybind
      observeKeyboard();
      window.addEventListener('key-switch-view', navHandler.switchViewEvent);
      window.addEventListener('key-save-document', reqSaveDoc);
      window.addEventListener('key-save-document-new-version', reqSaveDocNewVersion);
      window.addEventListener('key-new-document', reqNewDoc);
      window.addEventListener('key-rename-document', reqRenameDoc);
      window.addEventListener('key-archive-shelf', reqOpenArchiveDrawer);
      window.addEventListener('key-build-script', reqBuild);
      window.addEventListener('key-stop-playback', reqClearStopAnimation);
      
      window.addEventListener('canvas-ready', canvasReady);
      window.addEventListener('build-success', buildSuccess);
      window.addEventListener('build-error', buildError);

      await reqBuild();
    }
  });

  // Not actually necessary in present state, but just to be thorough.
  onDestroy(() => {
    if (browser) {
      harbor.rxDispose();

      window.removeEventListener('key-switch-view', navHandler.switchViewEvent);
      window.removeEventListener('key-save-document', reqSaveDoc);
      window.removeEventListener('key-save-document-new-version', reqSaveDocNewVersion);
      window.removeEventListener('key-new-document', reqNewDoc);
      window.removeEventListener('key-rename-document', reqRenameDoc);
      window.removeEventListener('key-archive-shelf', reqOpenArchiveDrawer);
      window.removeEventListener('key-build-script', reqBuild);
      window.removeEventListener('key-stop-playback', reqClearStopAnimation);

      window.removeEventListener('build-success', buildSuccess);
      window.removeEventListener('build-error', buildError);

      monacoEditor?.dispose();
      docHandler?.dispose();
      navHandler?.dispose();
      screenHandler?.dispose();
      mobileHandler?.dispose();

      resizeObserver.unobserve(viewportEl);
      resizeObserver.disconnect();
    }
    unsubscribeDocSession();
  });

  import { AppRail, AppRailTile, AppRailAnchor } from '@skeletonlabs/skeleton';

  import { Pane, Splitpanes } from 'svelte-splitpanes';

  // Icons
  import { Icon } from 'svelte-hero-icons';
  import * as hero from 'svelte-hero-icons';
  import { CustomIcon } from '$lib/components/icons';
  import * as ico from '$lib/components/icons';
</script>

<div class="card bg-surface-50-900-token rounded-none h-[100%] grid grid-cols-[auto_1fr] w-full">
  <AppRail class="w-8">
    <AppRailTile 
      title="Split-Pane"
      bind:group={$currentView} 
      name="tile-0" 
      value={0}>
      <svelte:fragment slot="lead">
        <Icon src="{hero.RectangleGroup}" size="16" style="margin: 4px auto;" solid/>
      </svelte:fragment>
    </AppRailTile>
    <AppRailTile 
      title="View Code"
      bind:group={$currentView} 
      name="tile-1" 
      value={1}>
      <svelte:fragment slot="lead">
        <Icon src="{hero.CodeBracket}" size="16" style="margin: 4px auto;" solid/>
      </svelte:fragment>
    </AppRailTile>
    <AppRailTile 
      title="View Canvas"
      bind:group={$currentView} 
      name="tile-2" 
      value={2}>
      <svelte:fragment slot="lead">
        <Icon src="{hero.Photo}" size="16" style="margin: 4px auto;" solid/>
      </svelte:fragment>
    </AppRailTile>
    <AppRailTile 
      title="View Controls" 
      bind:group={$currentView} 
      name="tile-3" 
      value={3}>
      <svelte:fragment slot="lead">
        <Icon src="{hero.AdjustmentsHorizontal}" size="16" style="margin: 4px auto;" solid/>
      </svelte:fragment>
    </AppRailTile>
    <hr classs="hr m-1"/>
    <AnchorScriptStatus buildCallback={reqBuild} stopCallback={reqStopAnimation} />
    <AppRailAnchor 
      href="#" 
      title="Toggle Auto-Build" 
      on:click={() => { isAutoBuild.set(!$isAutoBuild); }} 
      class={$isAutoBuild ? 'bg-tertiary-500' : ''} 
      style="display:block;">
      <Icon src="{hero.PlayCircle}" size="16" style="margin: 4px auto;" solid/>
    </AppRailAnchor>
    <hr classs="hr m-1"/>
    <AppRailAnchor 
      href="#" 
      title="Toggle Read-Only" 
      on:click={docHandler.toggleEditing} 
      class={$isReadOnly ? 'bg-tertiary-500' : ''} 
      style="display:block;">
      <Icon src="{$isReadOnly ? hero.LockClosed : hero.LockOpen}" size="16" style="margin: 4px auto;" solid/>
    </AppRailAnchor>
    <AppRailAnchor 
      href="#" 
      title="Toggle Fullscreen" 
      on:click={screenHandler.toggleFullscreen} 
      class={$isFullscreen ? 'bg-tertiary-500' : ''} 
      style="display:block;">
      <Icon src="{hero.ArrowsPointingOut}" size="16" style="margin: 4px auto;" solid/>
    </AppRailAnchor>
    <svelte:fragment slot="trail">
      <AppRailAnchor 
        href="#" 
        title="New Script (alt+{km.keyNewDoc})" 
        on:click={reqNewDoc}
        style="display:block;">
        <Icon src="{hero.Document}" size="16" style="margin: 4px auto;" solid/>
      </AppRailAnchor>
      <AppRailAnchor 
        href="#" 
        title="Archive (alt+{km.keyArchive})" 
        on:click={reqOpenArchiveDrawer}
        style="display:block;">
        <Icon src="{hero.Folder}" size="16" style="margin: 4px auto;" solid/>
      </AppRailAnchor>
      <AppRailAnchor 
        href="#" 
        title="Import / Export" 
        on:click={() => modalStore.trigger({
          ...modals.modalImportExport, 
          importFileCallback: reqImportFile,
          exportFileCallback: reqExportFile,
        })}
        style="display:block;">
        <Icon src="{hero.ArrowsUpDown}" size="16" style="margin: 4px auto;" solid/>
      </AppRailAnchor>
      <AnchorLightSwitch />
      <AppRailAnchor 
        href="#" 
        title="About" 
        on:click={() => modalStore.trigger(modals.modalAbout)}
        style="display:block;">
        <Icon src="{hero.QuestionMarkCircle}" size="16" style="margin: 4px auto;" solid/>
      </AppRailAnchor>
    </svelte:fragment>
  </AppRail>
  <div id="cr-panes" class="grid cr-dynamic">
    {#if $orientationLandscape}
    <Splitpanes theme="skeleton-theme" style="width: 100%; height: 100%;">
      <Pane minSize={20} bind:size={$paneSizes.sizeLandscapePaneLeft}>
        <div id="cr-pane1"/>
      </Pane>
      <Pane minSize={20} bind:size={$paneSizes.sizeLandscapePaneRight}>
        <Splitpanes horizontal={true}>
          <Pane minSize={15} bind:size={$paneSizes.sizeLandscapePaneTopRight}>
            <div id="cr-pane2" />
          </Pane>
          <Pane bind:size={$paneSizes.sizeLandscapePaneBottomRight}>
            <div id="cr-pane3" />
          </Pane>
        </Splitpanes>
      </Pane>
    </Splitpanes>
    {:else}
    <Splitpanes theme="skeleton-theme" style="width: 100%; height: 100%;" horizontal={true}>
      <Pane minSize={20} bind:size={$paneSizes.sizePortraitPaneTop}>
        <div id="cr-pane1" />
      </Pane>
      <Pane minSize={5} bind:size={$paneSizes.sizePortraitPaneMid}>
        <div id="cr-pane2" />
      </Pane>
      <Pane minSize={0} bind:size={$paneSizes.sizePortraitPaneBot}>
        <div id="cr-pane3" />
      </Pane>
    </Splitpanes>
    {/if}
  </div>
  <div id="cr-full" class="cr-dynamic hidden" />
  <div id="cr-staging" class="hidden">
    <div id="ct1">
      <MonacoEditor editorInstance={monacoEditor} on:init={setEditorInstance} />
    </div>
    <div id="ct2">
      <iframe 
        id="canvasframe" 
        width="800" 
        height="800" 
        src="./canvasframe.html" 
        scrolling="no" 
        sandbox="allow-scripts allow-popups"  
        title="canvasframe"> 
    </div>        
    <div id="ct3" class="divide-y divide-surface-400/10 !overflow-y-auto">
      <div class="overflow-x-auto flex p-1">
        <button 
          title="Save (alt+{km.keySaveDoc} / ctrl+{km.keySaveDoc})" 
          class="badge m-1 {dsCurrentSession.unsavedChanges ? 'variant-ghost-primary' : 'variant-soft-primary'}" 
          on:click={reqSaveDoc}
        >
          <Icon src="{hero.ArrowDownOnSquare}" size="16" class="mx-0 my-1" solid/>
          <span class="hidden lg:inline ml-2">Save</span>
        </button> 
        <button 
          title="Save v{dsCurrentSession.versionCount} (alt+{km.keySaveDocNewVersion})"
          class="badge m-1 {dsCurrentSession.unsavedChanges ? 'variant-ghost-primary' : 'variant-soft-primary'}"
          on:click={reqSaveDocNewVersion}
        >
          <Icon src="{hero.ArrowDownOnSquareStack}" size="16" class="mx-0 my-1" solid/>
          <span class="hidden lg:inline ml-2">Save v{dsCurrentSession.versionCount}</span>
        </button>
        <div class="ml-auto flex">
          <DocTitleBadge renameCallback={reqRenameDoc} switchVersionCallback={reqSwitchDocVersion} />
          <DocMenuBadge 
            revertCallback={reqRevertDoc} 
            resetPanesCallback={reqResetPanes} 
            forkCallback={reqForkDoc} 
            exportCallback={reqExportFile}
          />
        </div>
      </div>
      <div>        
        <StackTraceTable monacoEditor={monacoEditor} />
      </div>
    </div>
  </div>
</div>
<style>
  @import '$lib/styles/main.css';
  @import '$lib/styles/panes.css';
</style>