import SwiftUI

struct CompanionHomeView: View {
    @State private var allowGameProgress = false
    @State private var allowTimers = false
    @State private var allowNotes = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Verbindung") {
                    Label("Nicht verbunden", systemImage: "iphone.slash")
                    Text("Dies ist eine lokale Vorschau. Noch keine Verbindung zu JARVIS und kein Datentransfer.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                Section("Freigaben für eine zukünftige Kopplung") {
                    Toggle("Spielstände & offene Aufgaben", isOn: $allowGameProgress)
                    Toggle("Spiel-Timer", isOn: $allowTimers)
                    Toggle("Spiel-Notizen", isOn: $allowNotes)
                    Text("Diese Schalter übertragen noch keine Daten. Freigaben müssen später auch am PC bestätigt werden.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                Section("Datenschutz") {
                    Label("Keine automatische Cloud-Synchronisation", systemImage: "lock.shield")
                    Label("Keine API-Schlüssel oder Screenshots", systemImage: "eye.slash")
                    Label("Kopplung nur nach gegenseitiger Bestätigung", systemImage: "checkmark.shield")
                }
            }
            .navigationTitle("JARVIS Companion")
        }
    }
}

#Preview { CompanionHomeView() }
