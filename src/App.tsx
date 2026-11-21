import { Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from './layouts/AppLayout'
import { LoginPage } from './pages/LoginPage'
import { DashboardPage } from './pages/DashboardPage'
import { CashRegisterPage } from './pages/CashRegisterPage'
import { ProductsPage } from './pages/ProductsPage'
import { ClientsPage } from './pages/ClientsPage'
import { InventoryPage } from './pages/InventoryPage'
import { ProformasPage } from './pages/ProformasPage'
import { SalesPage } from './pages/SalesPage'
import { SuppliersPage } from './pages/SuppliersPage'
import { ReportsPage } from './pages/ReportsPage'
import { UsersPage } from './pages/UsersPage'
import { SettingsPage } from './pages/SettingsPage'
import { PAGE_ACCESS } from './lib/permissions'
import { ProtectedRoute } from './components/ProtectedRoute'
import { CategoriesPage } from './pages/CategoriesPage'
import { CustomerDetailPage } from './pages/CustomerDetailPage'
import { StockMovementsPage } from './pages/StockMovementsPage'
import { AccountingPage } from './pages/AccountingPage'
import { ExpensesPage } from './pages/ExpensesPage'
import { DailyReceiptsPage } from './pages/DailyReceiptsPage'
import { CashCountPage } from './pages/CashCountPage'
import { CashManagementPage } from './pages/CashManagementPage'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route element={<ProtectedRoute anyOf={PAGE_ACCESS['/caisse']} />}>
            <Route path="caisse" element={<CashRegisterPage />} />
          </Route>
          <Route path="produits" element={<ProductsPage />} />
          <Route path="clients" element={<ClientsPage />} />
          <Route path="clients/:id" element={<CustomerDetailPage />} />
          <Route element={<ProtectedRoute anyOf={PAGE_ACCESS['/categories']} />}>
            <Route path="categories" element={<CategoriesPage />} />
          </Route>
          <Route path="stock" element={<InventoryPage />} />
          <Route element={<ProtectedRoute anyOf={PAGE_ACCESS['/stock/mouvements']} />}>
            <Route path="stock/mouvements" element={<StockMovementsPage />} />
          </Route>
          <Route element={<ProtectedRoute anyOf={PAGE_ACCESS['/proformas']} />}>
            <Route path="proformas" element={<ProformasPage />} />
          </Route>
          <Route path="ventes" element={<SalesPage />} />
          <Route element={<ProtectedRoute anyOf={PAGE_ACCESS['/recettes-journalieres']} />}>
            <Route path="recettes-journalieres" element={<DailyReceiptsPage />} />
          </Route>
          <Route element={<ProtectedRoute anyOf={PAGE_ACCESS['/comptage-caisse']} />}>
            <Route path="comptage-caisse" element={<CashCountPage />} />
          </Route>
          <Route element={<ProtectedRoute anyOf={PAGE_ACCESS['/caisse/mouvements']} />}>
            <Route path="caisse/mouvements" element={<CashManagementPage />} />
          </Route>
          <Route element={<ProtectedRoute anyOf={PAGE_ACCESS['/fournisseurs']} />}>
            <Route path="fournisseurs" element={<SuppliersPage />} />
          </Route>
          <Route element={<ProtectedRoute anyOf={PAGE_ACCESS['/rapports']} />}>
            <Route path="rapports" element={<ReportsPage />} />
          </Route>
          <Route element={<ProtectedRoute anyOf={PAGE_ACCESS['/comptabilite']} />}>
            <Route path="comptabilite" element={<AccountingPage />} />
          </Route>
          <Route element={<ProtectedRoute anyOf={PAGE_ACCESS['/depenses']} />}>
            <Route path="depenses" element={<ExpensesPage />} />
          </Route>
          <Route element={<ProtectedRoute anyOf={PAGE_ACCESS['/utilisateurs']} />}>
            <Route path="utilisateurs" element={<UsersPage />} />
          </Route>
          <Route element={<ProtectedRoute anyOf={PAGE_ACCESS['/parametres']} />}>
            <Route path="parametres" element={<SettingsPage />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
