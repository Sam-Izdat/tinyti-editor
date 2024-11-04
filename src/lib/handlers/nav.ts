// SPA Navigation
import { get } from 'svelte/store';
import { currentView } from '$lib/stores/app_state';
import * as panes from '$lib/panes';
import { Log } from '$lib';
import { isReady } from '$lib/stores';

export class NavHandler {
  constructor(options = {}) {
    const {
      layoutChangeCallback = (() => {}),
    } = options;
    this.layoutChangeCallback = layoutChangeCallback;
    this.view = get(currentView);
    this.unsubscribeAll = [
      currentView.subscribe(view => {
        this.view = view;
        this.switchView();
      }),
    ];
  }
  
  dispose() { this.unsubscribeAll.forEach(unsub => unsub()); }

  switchViewEvent(event: CustomEvent) {
    currentView.set(event.detail.view);
  }

  switchView() {
    switch (this.view) {
      case 0:
        isReady.set(false);
        panes.returnContentToSplit(); 
        panes.showView(this.view);
        this.layoutChangeCallback();
        break;
      case 1:
        isReady.set(false);
        panes.returnContentToSplit(); 
        panes.moveContent('ct1', 'cr-full'); 
        panes.showView(this.view);
        this.layoutChangeCallback();
        break;
      case 2:
        isReady.set(false);
        panes.returnContentToSplit(); 
        panes.moveContent('ct2', 'cr-full'); 
        panes.showView(this.view);
        this.layoutChangeCallback();
        break;
      case 3:
        isReady.set(false);
        panes.returnContentToSplit(); 
        panes.moveContent('ct3', 'cr-full'); 
        panes.showView(this.view);
        this.layoutChangeCallback();
        break;
      default:
        Log.error('somehow tried to switch to nonexistent view...')
    }
  }
}