// Minimal host shell for @rocapine/community-core + @rocapine/community-ui:
// no router (task brief) — a plain `useState` "route" switches between the
// feed, a profile and the notification inbox, exactly as sketched in the
// task brief's snippet. `ProfileScreen` and `NotificationInboxScreen` both
// punt "open a post's thread" to the host (see their own file-header
// comments), so this shell owns one `ThreadSheet` instance for that —
// `CommunityFeedScreen` already renders its own internally for taps that
// happen inside the feed itself.
import { useState } from "react";
import { SafeAreaView, StatusBar, StyleSheet, Text } from "react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CommunityProvider } from "@rocapine/community-core";
import {
  CommunityFeedScreen,
  CommunityUIProvider,
  NotificationInboxScreen,
  ProfileScreen,
  ThreadSheet,
} from "@rocapine/community-ui";
import { config } from "./community-config";

const queryClient = new QueryClient();

type Route = "feed" | "profile" | "inbox";

export default function App() {
  const [route, setRoute] = useState<Route>("feed");
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [threadPostId, setThreadPostId] = useState<string | null>(null);

  return (
    <QueryClientProvider client={queryClient}>
      <CommunityProvider config={config}>
        <CommunityUIProvider theme={{ colors: { accent: "#6C4DF6" } }}>
          <SafeAreaView style={styles.root}>
            <StatusBar barStyle="dark-content" />

            {route === "feed" && (
              <CommunityFeedScreen
                onOpenProfile={(userId) => {
                  setProfileUserId(userId);
                  setRoute("profile");
                }}
                onOpenInbox={() => setRoute("inbox")}
                header={<Text style={styles.header}>Community SDK Demo</Text>}
              />
            )}

            {route === "profile" && profileUserId && (
              <ProfileScreen
                userId={profileUserId}
                onOpenThread={(postId) => setThreadPostId(postId)}
                onBack={() => {
                  setProfileUserId(null);
                  setRoute("feed");
                }}
              />
            )}

            {route === "inbox" && (
              <NotificationInboxScreen
                onOpenPost={(postId) => {
                  setRoute("feed");
                  setThreadPostId(postId);
                }}
              />
            )}

            <ThreadSheet
              postId={threadPostId}
              onClose={() => setThreadPostId(null)}
              onOpenProfile={(userId) => {
                setThreadPostId(null);
                setProfileUserId(userId);
                setRoute("profile");
              }}
            />
          </SafeAreaView>
        </CommunityUIProvider>
      </CommunityProvider>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { fontSize: 20, fontWeight: "700", paddingHorizontal: 16, paddingTop: 8 },
});
