import { createRouter, createWebHashHistory } from 'vue-router'
import DashboardView from '../views/DashboardView.vue'
import MonitorView from '../views/MonitorView.vue'
import RulesView from '../views/RulesView.vue'
import SettingsView from '../views/SettingsView.vue'
import KnowledgeBaseView from '../views/KnowledgeBaseView.vue'
import ImageLibraryView from '../views/ImageLibraryView.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'dashboard', component: DashboardView },
    { path: '/monitor', name: 'monitor', component: MonitorView },
    { path: '/rules', name: 'rules', component: RulesView },
    { path: '/kb', name: 'kb', component: KnowledgeBaseView },
    { path: '/images', name: 'images', component: ImageLibraryView },
    { path: '/settings', name: 'settings', component: SettingsView }
  ]
})

export default router
