import { useEffect, useState } from 'react'
import { Table, Card, Typography, Button, Space, message, Image } from 'antd'
import { UploadOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import type { ColumnsType } from 'antd/es/table'

const { Title, Link } = Typography

interface FileRecord {
  fileName: string
  url: string
  fileType: string
  createdAt: string
  uploader: string
}

interface ListResponse {
  list: FileRecord[]
  total: number
}

export default function FileList() {
  const navigate = useNavigate()
  const [data, setData] = useState<FileRecord[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [pagination, setPagination] = useState({ page: 1, pageSize: 10 })

  const fetchList = (page: number, pageSize: number) => {
    setLoading(true)
    fetch(`/oss?page=${page}&pageSize=${pageSize}`)
      .then(async (res) => {
        if (!res.ok) {
          const text = await res.text().catch(() => '')
          throw new Error(text || `HTTP ${res.status}`)
        }
        return res.json()
      })
      .then((res: ListResponse) => {
        setData(res.list)
        setTotal(res.total)
      })
      .catch((err: Error) => {
        message.error(`加载失败: ${err.message}`)
      })
      .finally(() => {
        setLoading(false)
      })
  }

  useEffect(() => {
    fetchList(pagination.page, pagination.pageSize)
  }, [pagination.page, pagination.pageSize])

  const columns: ColumnsType<FileRecord> = [
    {
      title: '文件名',
      dataIndex: 'fileName',
      key: 'fileName',
      ellipsis: true,
    },
    {
      title: '文件访问链接',
      dataIndex: 'url',
      key: 'url',
      ellipsis: true,
      render: (url: string) => (
        <Link href={url} target="_blank" style={{ maxWidth: 300 }} ellipsis>
          {url}
        </Link>
      ),
    },
    {
      title: '文件类型',
      dataIndex: 'fileType',
      key: 'fileType',
      width: 120,
    },
    {
      title: '预览',
      key: 'preview',
      width: 100,
      render: (_: unknown, record: FileRecord) => {
        const isImage = record.fileType?.toLowerCase().startsWith('image/')
        if (!isImage) {
          return '-'
        }
        return (
          <Image
            src={record.url}
            alt={record.fileName}
            style={{ width: 60, height: 60, objectFit: 'cover' }}
            preview={{ mask: '预览' }}
          />
        )
      },
    },
    {
      title: '上传时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 200,
      render: (value: string) => {
        if (!value) return '-'
        return new Date(value).toLocaleString('zh-CN', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      },
    },
    {
      title: '上传人',
      dataIndex: 'createdBy',
      key: 'uploader',
      width: 120,
    },
  ]

  return (
    <div style={{ padding: 24 }}>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <Title level={3} style={{ margin: 0 }}>
            文件列表
          </Title>
          <Space>
            <Button type="primary" icon={<UploadOutlined />} onClick={() => navigate('/upload')}>
              上传文件
            </Button>
          </Space>
        </div>

        <Table
          columns={columns}
          dataSource={data}
          rowKey={(record) => record.url}
          loading={loading}
          pagination={{
            current: pagination.page,
            pageSize: pagination.pageSize,
            total,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 个文件`,
            onChange: (page, pageSize) => {
              setPagination({ page, pageSize })
            },
          }}
        />
      </Card>
    </div>
  )
}
