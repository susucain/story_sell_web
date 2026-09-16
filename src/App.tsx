import { Routes, Route, Navigate } from 'react-router-dom'
// import { Layout, Menu } from 'antd'
// import { UploadOutlined, UnorderedListOutlined, VideoCameraOutlined } from '@ant-design/icons'
// import FileUpload from './pages/FileUpload'
// import FileList from './pages/FileList'
import VideoStoryboard from './pages/VideoStoryboard'
import { AuthPage } from './pages/Auth/AuthPage'
import { RequireAuth } from './auth/RequireAuth'
import { PublicOnly } from './auth/PublicOnly'
import './App.css'

// const { Header, Content } = Layout

// const navItems = [
//   { key: '/', icon: <UploadOutlined />, label: <Link to="/">上传文件</Link> },
//   { key: '/files', icon: <UnorderedListOutlined />, label: <Link to="/files">文件列表</Link> },
//   { key: '/life-video', icon: <VideoCameraOutlined />, label: <Link to="/life-video">视频分镜</Link> },
// ]

export default function App() {
  return (
    <Routes>
      <Route element={<PublicOnly />}>
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/register" element={<AuthPage mode="register" />} />
      </Route>
      <Route element={<RequireAuth />}>
        <Route path="/life-video" element={<VideoStoryboard />} />
      </Route>
      <Route path="*" element={<Navigate to="/life-video" replace />} />
    </Routes>
  )

  // 原始布局（已隐藏顶部导航栏和其余 tab）
  // return (
  //   <Layout style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
  //     <Header
  //       style={{
  //         display: 'flex',
  //         alignItems: 'center',
  //         paddingInline: 24,
  //         position: 'sticky',
  //         top: 0,
  //         zIndex: 100,
  //         flexShrink: 0,
  //       }}
  //     >
  //       <div style={{ color: '#fff', fontWeight: 600, fontSize: 16, marginRight: 32, whiteSpace: 'nowrap' }}>
  //         AGUI
  //       </div>
  //       <Menu
  //         theme="dark"
  //         mode="horizontal"
  //         selectedKeys={[location.pathname]}
  //         items={navItems}
  //         style={{ flex: 1, minWidth: 0 }}
  //       />
  //     </Header>
  //     <Content style={{ flex: 1, overflow: 'auto', padding: 24 }}>
  //       <Routes>
  //         <Route path="/" element={<FileUpload />} />
  //         <Route path="/files" element={<FileList />} />
  //         <Route path="/life-video" element={<VideoStoryboard />} />
  //       </Routes>
  //     </Content>
  //   </Layout>
  // )
}
