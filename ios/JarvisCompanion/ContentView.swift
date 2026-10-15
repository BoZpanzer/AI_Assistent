import SwiftUI
struct ContentView: View {
  var body: some View {
    NavigationStack {
      List {
        Text("Kalender")
        Text("Alltag")
        Text("Wissen")
        Text("Einstellungen")
        Text("Noch keine Synchronisation eingerichtet")
      }.navigationTitle("JARVIS")
    }
  }
}
