import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Switch,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { C } from "../../lib/theme";
import { useSettings, useSettingsMutation } from "../../lib/hooks";
import { metaFor, resolveTabConfig, DEFAULT_TAB_CONFIG, type TabConfigItem } from "../../lib/tabs";

export default function TabSettingsScreen() {
  const settings = useSettings();
  const { update } = useSettingsMutation();
  const router = useRouter();

  const [items, setItems] = useState<TabConfigItem[]>([]);

  useEffect(() => {
    if (settings.data) setItems(resolveTabConfig(settings.data.tabConfig));
  }, [settings.data]);

  const move = (index: number, dir: -1 | 1) => {
    const next = [...items];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setItems(next);
  };

  const toggleVisible = (index: number) => {
    const next = [...items];
    // Schedule (index) must stay visible — it's the home tab.
    if (next[index].key === "index") return;
    next[index] = { ...next[index], visible: !next[index].visible };
    setItems(next);
  };

  const save = () => {
    update.mutate(
      { tabConfig: items },
      { onSuccess: () => router.back() }
    );
  };

  const reset = () => setItems(DEFAULT_TAB_CONFIG);

  if (settings.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={["left", "right"]}>
        <View style={styles.center}>
          <ActivityIndicator color={C.brand} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["left", "right"]}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
        <Text style={styles.intro}>
          Use the arrows to reorder tabs and the switches to show or hide them. The Schedule tab
          stays first-class and can't be hidden.
        </Text>

        <View style={styles.list}>
          {items.map((item, i) => {
            const meta = metaFor(item.key);
            if (!meta) return null;
            const locked = item.key === "index";
            return (
              <View key={item.key} style={styles.row}>
                <View style={styles.arrows}>
                  <TouchableOpacity
                    style={[styles.arrowBtn, i === 0 && styles.arrowDisabled]}
                    disabled={i === 0}
                    onPress={() => move(i, -1)}
                  >
                    <Ionicons name="chevron-up" size={18} color={i === 0 ? C.border : C.brand} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.arrowBtn, i === items.length - 1 && styles.arrowDisabled]}
                    disabled={i === items.length - 1}
                    onPress={() => move(i, 1)}
                  >
                    <Ionicons
                      name="chevron-down"
                      size={18}
                      color={i === items.length - 1 ? C.border : C.brand}
                    />
                  </TouchableOpacity>
                </View>

                <View style={styles.iconWrap}>
                  <Ionicons name={meta.icon} size={20} color={item.visible ? C.brand : C.muted} />
                </View>

                <View style={{ flex: 1 }}>
                  <Text style={[styles.label, !item.visible && styles.labelHidden]}>
                    {meta.title}
                  </Text>
                  <Text style={styles.position}>Position {i + 1}</Text>
                </View>

                {locked ? (
                  <View style={styles.lockPill}>
                    <Ionicons name="lock-closed" size={12} color={C.muted} />
                    <Text style={styles.lockText}>Home</Text>
                  </View>
                ) : (
                  <Switch
                    value={item.visible}
                    onValueChange={() => toggleVisible(i)}
                    trackColor={{ true: C.sage, false: C.border }}
                    thumbColor={item.visible ? C.brand : "#f4f4f4"}
                  />
                )}
              </View>
            );
          })}
        </View>

        <TouchableOpacity style={styles.resetBtn} onPress={reset}>
          <Ionicons name="refresh-outline" size={16} color={C.brand} />
          <Text style={styles.resetText}>Reset to default</Text>
        </TouchableOpacity>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.saveBtn, update.isPending && { opacity: 0.6 }]}
          disabled={update.isPending}
          onPress={save}
        >
          <Text style={styles.saveText}>{update.isPending ? "Saving…" : "Save changes"}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  intro: { color: C.muted, fontSize: 13, lineHeight: 19, marginBottom: 16 },
  list: { backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, overflow: "hidden" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  arrows: { gap: 4 },
  arrowBtn: {
    width: 30,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 6,
    backgroundColor: C.bg,
    borderWidth: 1,
    borderColor: C.border,
  },
  arrowDisabled: { opacity: 0.5 },
  iconWrap: { width: 30, alignItems: "center" },
  label: { fontSize: 15, fontWeight: "700", color: C.text },
  labelHidden: { color: C.muted, textDecorationLine: "line-through" },
  position: { fontSize: 11, color: C.muted, marginTop: 1 },
  lockPill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: C.bg, borderRadius: 8 },
  lockText: { fontSize: 11, color: C.muted, fontWeight: "600" },
  resetBtn: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "center", marginTop: 18, paddingVertical: 8 },
  resetText: { color: C.brand, fontWeight: "700", fontSize: 13 },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    padding: 16,
    backgroundColor: C.card,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  saveBtn: { backgroundColor: C.brand, paddingVertical: 14, borderRadius: 12, alignItems: "center" },
  saveText: { color: "#fff", fontWeight: "700", fontSize: 15 },
});
