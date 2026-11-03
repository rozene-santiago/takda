import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Image, View, Text } from "react-native";
import { C } from "../../lib/theme";
import { useSettings } from "../../lib/hooks";
import { TAB_META, SETTINGS_TAB_KEY, resolveTabConfig, metaFor } from "../../lib/tabs";

function HeaderTitle({ title }: { title: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Image
        source={require("../../assets/crest-white.png")}
        style={{ width: 22, height: 24, resizeMode: "contain" }}
      />
      <Text style={{ color: "#fff", fontWeight: "700", fontSize: 18 }}>{title}</Text>
    </View>
  );
}

// Tabs hidden from the bar while in lockdown (read-only) mode.
const LOCK_HIDDEN_KEYS = new Set(["allocations", "teachers", "setup"]);

export default function TabsLayout() {
  const settings = useSettings();
  const locked = !!settings.data?.locked;
  const config = resolveTabConfig(settings.data?.tabConfig);

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: C.brand },
        headerTintColor: "#fff",
        headerTitleStyle: { fontWeight: "700" },
        tabBarActiveTintColor: C.brand,
        tabBarInactiveTintColor: C.muted,
        tabBarStyle: { backgroundColor: C.card, borderTopColor: C.border },
        tabBarLabelStyle: { fontSize: 10 },
      }}
    >
      {config.map((item) => {
        const meta = metaFor(item.key);
        if (!meta) return null;
        return (
          <Tabs.Screen
            key={meta.key}
            name={meta.key}
            options={{
              title: meta.title,
              headerTitle: () => <HeaderTitle title={meta.header} />,
              // Hidden tabs stay routable but are removed from the bar.
              // Lockdown also hides editing tabs (allocations/teachers/setup).
              href: item.visible && !(locked && LOCK_HIDDEN_KEYS.has(item.key)) ? undefined : null,
              tabBarIcon: ({ color, size }) => (
                <Ionicons name={meta.icon} color={color} size={size} />
              ),
            }}
          />
        );
      })}

      {/* Tab customization screen — reachable from Setup, never shown in the bar. */}
      <Tabs.Screen
        name={SETTINGS_TAB_KEY}
        options={{
          href: null,
          headerTitle: () => <HeaderTitle title="Arrange Tabs" />,
        }}
      />
    </Tabs>
  );
}
