import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Container,
  Color,
  TableV2 as Table,
  Text,
  Utils,
  StringSubstitute,
  Layout,
  TextProps,
  Icon
} from '@harness/uicore'
import cx from 'classnames'
import type { CellProps, Column } from 'react-table'
import { Render } from 'react-jsx-match'
import { chunk, clone, sortBy, throttle } from 'lodash-es'
import { useMutate } from 'restful-react'
import { Link, useHistory } from 'react-router-dom'
import { useAppContext } from 'AppContext'
import type { OpenapiContentInfo, OpenapiDirContent, TypesCommit } from 'services/code'
import { formatDate, LIST_FETCHING_LIMIT } from 'utils/Utils'
import { findReadmeInfo, CodeIcon, GitInfoProps, isFile } from 'utils/GitUtils'
import { LatestCommitForFolder } from 'components/LatestCommit/LatestCommit'
import { useEventListener } from 'hooks/useEventListener'
import { Readme } from './Readme'
import repositoryCSS from '../../Repository.module.scss'
import css from './FolderContent.module.scss'

type FolderContentProps = Pick<GitInfoProps, 'repoMetadata' | 'resourceContent' | 'gitRef'>

export function FolderContent({ repoMetadata, resourceContent, gitRef }: FolderContentProps) {
  const history = useHistory()
  const { routes, standalone } = useAppContext()
  const columns: Column<OpenapiContentInfo>[] = useMemo(
    () => [
      {
        id: 'name',
        width: '30%',
        Cell: ({ row }: CellProps<OpenapiContentInfo>) => (
          <Container>
            <Layout.Horizontal spacing="small">
              <Icon name={isFile(row.original) ? CodeIcon.File : CodeIcon.Folder} />
              <ListingItemLink
                url={routes.toCODERepository({
                  repoPath: repoMetadata.path as string,
                  gitRef,
                  resourcePath: row.original.path
                })}
                text={row.original.name as string}
                data-resource-path={row.original.path}
                lineClamp={1}
              />
            </Layout.Horizontal>
          </Container>
        )
      },
      {
        id: 'message',
        width: 'calc(70% - 100px)',
        Cell: ({ row }: CellProps<OpenapiContentInfo>) => (
          <CommitMessageLinks repoMetadata={repoMetadata} rowData={row.original} />
        )
      },
      {
        id: 'when',
        width: '100px',
        Cell: ({ row }: CellProps<OpenapiContentInfo>) => {
          return (
            <Text lineClamp={1} color={Color.GREY_500} className={css.rowText}>
                {!!row.original.latest_commit?.author?.when ? formatDate(row.original.latest_commit?.author?.when as string) : ""}
            </Text>
          )
        }
      }
    ],
    [] // eslint-disable-line react-hooks/exhaustive-deps
  )
  const readmeInfo = useMemo(() => findReadmeInfo(resourceContent), [resourceContent])
  const scrollElement = useMemo(
    () => (standalone ? document.querySelector(`.${repositoryCSS.main}`)?.parentElement : window) as HTMLElement,
    [standalone]
  )
  const resourceEntries = useMemo(
    () => sortBy((resourceContent.content as OpenapiDirContent)?.entries || [], ['type', 'name']),
    [resourceContent.content]
  )
  const [pathsChunks, setPathsChunks] = useState<PathsChunks>([])
  const { mutate: fetchLastCommitsForPaths } = useMutate<PathDetails>({
    verb: 'POST',
    path: `/api/v1/repos/${encodeURIComponent(repoMetadata.path as string)}/path-details`
  })
  const [lastCommitMapping, setLastCommitMapping] = useState<Record<string, TypesCommit>>({})
  const mergedContentEntries = useMemo(
    () =>
      resourceEntries.map(entry => ({
        ...entry,
        latest_commit: lastCommitMapping[entry.path as string] || entry.latest_commit
      })),
    [resourceEntries, lastCommitMapping]
  )

  // The idea is to fetch last commit details for chunks that has atleast one path which is
  // rendered in the viewport
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const scrollCallback = useCallback(
    throttle(() => {
      pathsChunks.forEach(pathsChunk => {
        const { paths, loaded, loading, failed } = pathsChunk

        if (!loaded && !loading && !failed) {
          for (let i = 0; i < paths.length; i++) {
            const element = document.querySelector(`[data-resource-path="${paths[i]}"]`)

            if (element && isInViewport(element)) {
              pathsChunk.loading = true

              setPathsChunks(pathsChunks.map(_chunk => (pathsChunk === _chunk ? pathsChunk : _chunk)))

              fetchLastCommitsForPaths({ paths })
                .then(response => {
                  const pathMapping: Record<string, TypesCommit> = clone(lastCommitMapping)

                  pathsChunk.loaded = true
                  setPathsChunks(pathsChunks.map(_chunk => (pathsChunk === _chunk ? pathsChunk : _chunk)))

                  response?.details?.forEach(({ path, last_commit }) => {
                    pathMapping[path] = last_commit
                  })
                  setLastCommitMapping(pathMapping)
                })
                .catch(error => {
                  pathsChunk.loaded = false
                  pathsChunk.loading = false
                  pathsChunk.failed = true
                  setPathsChunks(pathsChunks.map(_chunk => (pathsChunk === _chunk ? pathsChunk : _chunk)))
                  console.log('Failed to fetch path commit details', error) // eslint-disable-line no-console
                })

              break
            }
          }
        }
      })
    }, 100),
    [pathsChunks, lastCommitMapping]
  )

  // Group all resourceEntries paths into chunks, each has LIST_FETCHING_LIMIT paths
  useEffect(() => {
    setPathsChunks(
      chunk(resourceEntries.map(entry => entry.path as string) || [], LIST_FETCHING_LIMIT).map(paths => ({
        paths,
        loaded: false,
        loading: false,
        failed: false
      }))
    )
  }, [resourceEntries])

  useEventListener('scroll', scrollCallback, scrollElement)

  // Trigger scroll event callback on mount and cancel it on unmount
  useEffect(() => {
    scrollCallback()

    return () => {
      scrollCallback.cancel()
    }
  }, [scrollCallback])

  return (
    <Container className={css.folderContent}>
      <LatestCommitForFolder repoMetadata={repoMetadata} latestCommit={resourceContent?.latest_commit} />

      <Table<OpenapiContentInfo>
        className={css.table}
        hideHeaders
        columns={columns}
        data={mergedContentEntries}
        onRowClick={entry => {
          history.push(
            routes.toCODERepository({
              repoPath: repoMetadata.path as string,
              gitRef,
              resourcePath: entry.path
            })
          )
        }}
        getRowClassName={() => css.row}
      />

      <Render when={readmeInfo}>
        <Readme metadata={repoMetadata} readmeInfo={readmeInfo as OpenapiContentInfo} gitRef={gitRef} />
      </Render>
    </Container>
  )
}

function isInViewport(element: Element) {
  const rect = element.getBoundingClientRect()
  return (
    rect.top >= 0 &&
    rect.left >= 0 &&
    rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
    rect.right <= (window.innerWidth || document.documentElement.clientWidth)
  )
}

type PathDetails = {
  details: Array<{
    path: string
    last_commit: TypesCommit
  }>
}

type PathsChunks = Array<{
  paths: string[]
  loaded: boolean
  loading: boolean
  failed: boolean
}>

interface CommitMessageLinksProps extends Pick<GitInfoProps, 'repoMetadata'> {
  rowData: OpenapiContentInfo
}

const CommitMessageLinks: React.FC<CommitMessageLinksProps> = ({ repoMetadata, rowData }) => {
  const { routes } = useAppContext()
  let title: string | JSX.Element = (rowData.latest_commit?.title || '') as string
  const match = title.match(/\(#\d+\)$/)

  if (match?.length) {
    const titleWithoutPullRequestId = title.replace(match[0], '')
    const pullRequestId = match[0].replace('(#', '').replace(')', '')

    title = (
      <StringSubstitute
        str="{COMMIT_URL}&nbsp;({PR_URL})"
        vars={{
          COMMIT_URL: (
            <ListingItemLink
              url={routes.toCODECommit({
                repoPath: repoMetadata.path as string,
                commitRef: rowData.latest_commit?.sha as string
              })}
              text={titleWithoutPullRequestId}
            />
          ),
          PR_URL: (
            <ListingItemLink
              url={routes.toCODEPullRequest({
                repoPath: repoMetadata.path as string,
                pullRequestId
              })}
              text={`#${pullRequestId}`}
              className={css.hightlight}
              wrapperClassName={css.noShrink}
            />
          )
        }}
      />
    )
  } else {
    title = (
      <ListingItemLink
        url={routes.toCODECommit({
          repoPath: repoMetadata.path as string,
          commitRef: rowData.latest_commit?.sha as string
        })}
        text={title}
      />
    )
  }

  return (
    <Container>
      <Layout.Horizontal className={css.commitMsgLayout}>{title}</Layout.Horizontal>
    </Container>
  )
}

interface ListingItemLinkProps extends TextProps {
  url: string
  text: string
  wrapperClassName?: string
}

const ListingItemLink: React.FC<ListingItemLinkProps> = ({ url, text, className, wrapperClassName, ...props }) => (
  <Container onClick={Utils.stopEvent} className={cx(css.linkContainer, wrapperClassName)}>
    <Link className={css.link} to={url}>
      <Text tag="span" color={Color.BLACK} lineClamp={1} className={cx(css.text, className)} {...props}>
        {text.trim()}
      </Text>
    </Link>
  </Container>
)
