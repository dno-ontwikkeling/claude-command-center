package com.olivier.commandcenter.remote;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugins must be registered before the bridge is created.
        registerPlugin(RemoteLinkPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
