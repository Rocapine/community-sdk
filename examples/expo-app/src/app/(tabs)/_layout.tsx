import { Tabs } from "expo-router";
import { SymbolView } from "expo-symbols";

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }}>
      <Tabs.Screen
        name="index"
        options={{
          title: "Community",
          tabBarIcon: ({ color }) => (
            <SymbolView name="bubble.left.and.bubble.right" tintColor={color} size={24} />
          ),
        }}
      />
      <Tabs.Screen
        name="config"
        options={{
          title: "Config",
          tabBarIcon: ({ color }) => (
            <SymbolView name="slider.horizontal.3" tintColor={color} size={24} />
          ),
        }}
      />
    </Tabs>
  );
}
