<script lang="ts">
  import { Log } from '$lib';
  import { onMount, onDestroy } from 'svelte';
  import { popup } from '@skeletonlabs/skeleton';
  import { scriptErrorLog } from '$lib/stores'; // Store for message queue
  import { AppRailAnchor } from '@skeletonlabs/skeleton';
  import * as km from '$lib/keymap';

  export let buildCallback = () => {};
  export let stopCallback = () => {};

  type MessageStatus = 'info' | 'success' | 'warning' | 'error';

  interface Message {
    status: MessageStatus;
    message: string;
  }

  let messages: Message[] = [];
  
  scriptErrorLog.subscribe((log) => {
    messages = log;
  });

  const getClass = (status: MessageStatus) => {
    switch (status) {
      case 'info':
        return 'variant-filled-info';
      case 'success':
        return 'variant-filled-success';
      case 'warning':
        return 'variant-filled-warning';
      case 'error':
        return 'variant-filled-error';
      default:
        return '';
    }
  }

  let ready         = false;
  let scriptStatus  = 0;
  let statusClass   = '';
  let activeIcon    = hero.Play;
  
  const unsubscribe = Log.getInstance().scriptStatus.subscribe(status => {
    scriptStatus = status;
    statusClass = '';
    activeIcon = hero.Play;
    if (status & Log.ScriptStatus.SUCCESS) {
      statusClass = 'bg-success-500';
      activeIcon = hero.Stop;
    }
    if (status & Log.ScriptStatus.WARNING) {
      statusClass = 'bg-warning-500';
      activeIcon = hero.ExclamationTriangle;
    }
    if (status & Log.ScriptStatus.ERROR) {
      statusClass = 'bg-error-500';
      activeIcon = hero.ExclamationCircle;
    }

    if (ready && !(status & Log.ScriptStatus.SUCCESS)) stopCallback();
  });
  
  onMount (async() => {
    ready = true;
  });

  onDestroy(() => {
    unsubscribe();
  });

  // Icons
  import { Icon } from 'svelte-hero-icons';
  import * as hero from 'svelte-hero-icons';
  import { CustomIcon } from '$lib/components/icons';
  import * as ico from '$lib/components/icons';
</script>

<!-- Need wrapper because AppRailAnchor can't use popup -->
<div class="m-0 p-0" 
  use:popup={{ event: 'hover', target: 'error-popup', placement: 'right' }}
>
<AppRailAnchor 
  href="#" 
  title="Build (alt+{km.keyBuild})" 
  class={statusClass} 
  style="display:block;"
  on:click={scriptStatus & Log.ScriptStatus.SUCCESS ? stopCallback : buildCallback}
>
  <Icon src="{activeIcon}" size="16" style="margin: 4px auto;" solid />
  <div 
    class="card place-content-stretch text-left font-normal p-1 max-w-72 bg-gradient-to-br variant-gradient-error-warning shadow shadow-error-900" 
    data-popup="error-popup"
    style="z-index: 100;">
    <div class="card p-1 variant-filled-surface max-h-screen overflow-y-auto">
      {#each messages as { status, message } (message)}
        <aside class="alert p-1 m-1 {getClass(status)}">
          <div class="alert-message text-xs">
            {message}
          </div>
        </aside>
      {/each}
      <div class="arrow bg-gradient-to-br variant-gradient-error-warning" />
    </div>
  </div>
</AppRailAnchor>
</div>